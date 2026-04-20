"""Integration tests for POST /config/credit-period/{canonical_id} — analyst-facing edit.

Coverage:
  1. Happy path: supersedes — old row valid_to set, new row inserted
  2. Idempotent no-op: same (days, reason_note) → no new row, result='noop'
  3. ANALYST in-scope → 200
  4. ANALYST cross-entity → 403
  5. CFO → 403
  6. PENDING → 403
  7. Audit log row written on supersede
  8. days < 0 → 422 (pydantic validation)
  9. No active config → insert (result='inserted')
 10. Audit log written on insert (no prior config)
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.credit_period_config import CreditPeriodConfig
from app.db.models.entity import Entity
from app.db.models.party import PartyCanonical
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth / setup helpers (mirror test_config_credit_period.py patterns)
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _csrf_headers(client: TestClient) -> dict[str, str]:
    csrf = _csrf(client)
    return {"X-CSRF-Token": csrf} if csrf else {}


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient,
    db_session: Session,
    email: str,
    entity_code: str | None = None,
) -> uuid.UUID:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    if entity_code is not None:
        entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
        assert entity is not None
        user.entity_id_scope = entity.id
    else:
        user.entity_id_scope = None
    user.is_active = True
    db_session.flush()
    return cast(uuid.UUID, user.id)


def _login_as_cfo(client: TestClient, db_session: Session, email: str) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _login_as_pending(client: TestClient, email: str) -> None:
    _login(client, email)


def _get_admin_user(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert user is not None
    return user


def _get_entity(db_session: Session, entity_code: str) -> Entity:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    return entity


def _create_canonical(db_session: Session, entity_code: str, name: str) -> uuid.UUID:
    admin = _get_admin_user(db_session)
    entity = _get_entity(db_session, entity_code)
    canonical = PartyCanonical(entity_id=entity.id, name=name, created_by=admin.id)
    db_session.add(canonical)
    db_session.flush()
    return cast(uuid.UUID, canonical.id)


def _create_credit_period_row(
    db_session: Session,
    canonical_id: uuid.UUID,
    credit_days: int,
    valid_from: date,
    valid_to: date | None = None,
    reason_note: str | None = None,
) -> uuid.UUID:
    admin = _get_admin_user(db_session)
    cfg = CreditPeriodConfig(
        canonical_id=canonical_id,
        days=credit_days,
        reason_note=reason_note,
        valid_from=valid_from,
        valid_to=valid_to,
        updated_by=admin.id,
    )
    db_session.add(cfg)
    db_session.flush()
    return cast(uuid.UUID, cfg.id)


def _edit_url(canonical_id: uuid.UUID) -> str:
    return f"/config/credit-period/{canonical_id}"


# ---------------------------------------------------------------------------
# Test 1: Happy path — supersede (days differ from active config)
# ---------------------------------------------------------------------------


def test_edit_credit_period_supersedes_active(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditSupersederParty")
    prior_id = _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 45, "reason_note": "Yatra terms changed"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["result"] == "superseded"
    assert body["days"] == 45
    assert body["reason_note"] == "Yatra terms changed"

    # Prior open row must be closed
    db_session.expire_all()
    prior = db_session.get(CreditPeriodConfig, prior_id)
    assert prior is not None
    assert prior.valid_to is not None, "Old row should have valid_to set"

    # New open row must exist
    new_open = db_session.scalar(
        select(CreditPeriodConfig).where(
            CreditPeriodConfig.canonical_id == canonical_id,
            CreditPeriodConfig.valid_to.is_(None),
        )
    )
    assert new_open is not None
    assert new_open.days == 45
    assert new_open.id != prior_id


# ---------------------------------------------------------------------------
# Test 2: Idempotent no-op — same (days, reason_note) → no new row
# ---------------------------------------------------------------------------


def test_edit_credit_period_noop_same_values(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditNoopParty")
    existing_id = _create_credit_period_row(
        db_session, canonical_id, 30, date(2026, 1, 1), reason_note="existing note"
    )

    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 30, "reason_note": "existing note"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["result"] == "noop"
    assert body["config_id"] == str(existing_id)

    # Row count must not have increased (still exactly one open row)
    db_session.expire_all()
    open_rows = db_session.scalars(
        select(CreditPeriodConfig).where(
            CreditPeriodConfig.canonical_id == canonical_id,
            CreditPeriodConfig.valid_to.is_(None),
        )
    ).all()
    assert len(open_rows) == 1
    assert open_rows[0].id == existing_id


# ---------------------------------------------------------------------------
# Test 3: ANALYST in-scope → 200
# ---------------------------------------------------------------------------


def test_edit_credit_period_analyst_in_scope(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditAnalystInScope")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    _login_as_analyst(client, db_session, "analyst.edit.ind@emb.global", entity_code="IND")
    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 60},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["result"] == "superseded"


# ---------------------------------------------------------------------------
# Test 4: ANALYST cross-entity → 403
# ---------------------------------------------------------------------------


def test_edit_credit_period_analyst_cross_entity_403(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    # Canonical is in IND
    canonical_id = _create_canonical(db_session, "IND", "EditAnalystCrossEntity")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    # Analyst scoped to UAE
    _login_as_analyst(client, db_session, "analyst.edit.uae@emb.global", entity_code="UAE")
    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 60},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 5: CFO → 403
# ---------------------------------------------------------------------------


def test_edit_credit_period_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditCFOParty")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    _login_as_cfo(client, db_session, "cfo.edit@emb.global")
    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 45},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 6: PENDING → 403
# ---------------------------------------------------------------------------


def test_edit_credit_period_pending_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditPendingParty")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    _login_as_pending(client, "pending.edit@emb.global")
    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 45},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 7: Audit log written on supersede
# ---------------------------------------------------------------------------


def test_edit_credit_period_audit_log_on_supersede(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditAuditSupersede")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 90, "reason_note": "Audit check"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200
    new_config_id = uuid.UUID(resp.json()["config_id"])

    db_session.expire_all()
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "CREDIT_PERIOD_EDITED",
            AuditLog.entity_id == new_config_id,
        )
    )
    assert audit is not None
    assert audit.after["days"] == 90
    assert audit.after["result"] == "superseded"
    assert audit.before.get("days") == 30  # prior config days in before


# ---------------------------------------------------------------------------
# Test 8: days < 0 → 422 (pydantic ge=0 constraint)
# ---------------------------------------------------------------------------


def test_edit_credit_period_negative_days_422(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditNegativeDays")

    resp = client.post(
        _edit_url(canonical_id),
        json={"days": -5},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Test 9: No active config → insert (result='inserted')
# ---------------------------------------------------------------------------


def test_edit_credit_period_no_prior_config_inserts(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditNoPriorConfig")
    # No CreditPeriodConfig row created for this canonical

    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 15, "reason_note": "First config"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["result"] == "inserted"
    assert body["days"] == 15

    # Exactly one open row must exist
    db_session.expire_all()
    open_rows = db_session.scalars(
        select(CreditPeriodConfig).where(
            CreditPeriodConfig.canonical_id == canonical_id,
            CreditPeriodConfig.valid_to.is_(None),
        )
    ).all()
    assert len(open_rows) == 1


# ---------------------------------------------------------------------------
# Test 10: Audit log on insert (no prior config)
# ---------------------------------------------------------------------------


def test_edit_credit_period_audit_log_on_insert(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "EditAuditInsert")

    resp = client.post(
        _edit_url(canonical_id),
        json={"days": 20},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200
    new_config_id = uuid.UUID(resp.json()["config_id"])

    db_session.expire_all()
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "CREDIT_PERIOD_EDITED",
            AuditLog.entity_id == new_config_id,
        )
    )
    assert audit is not None
    assert audit.after["days"] == 20
    assert audit.after["result"] == "inserted"
    # before must be empty (no prior row)
    assert audit.before == {}
