"""Integration tests for GET/POST/PATCH/DELETE /config/credit-period (M3 Task 6).

Coverage:
- GET: pagination, entity filter, include_closed, party_name filter
- POST: creates new row, closes prior open row, no prior row case
- PATCH: open row only, closed row → 409
- DELETE: 405
- RBAC: analyst own entity, analyst wrong entity, admin any, CFO read, PENDING 403
- Audit log on every mutation
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
# Auth helpers
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


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


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _get_admin_user(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert user is not None
    return user


def _get_entity(db_session: Session, entity_code: str) -> Entity:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    return entity


def _create_canonical(
    db_session: Session,
    entity_code: str,
    name: str,
) -> uuid.UUID:
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


def _csrf_headers(client: TestClient) -> dict[str, str]:
    csrf = _csrf(client)
    return {"X-CSRF-Token": csrf} if csrf else {}


# ---------------------------------------------------------------------------
# Test 1: GET list — basic happy path returns items
# ---------------------------------------------------------------------------


def test_get_credit_periods_basic(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "GetTestParty")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.get("/config/credit-period")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "pagination" in body
    # At minimum we have the row we created
    assert body["pagination"]["total"] >= 1


# ---------------------------------------------------------------------------
# Test 2: GET — entity_code filter
# ---------------------------------------------------------------------------


def test_get_credit_periods_entity_filter(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    ind_canonical_id = _create_canonical(db_session, "IND", "IndFilterParty")
    uae_canonical_id = _create_canonical(db_session, "UAE", "UAEFilterParty")
    _create_credit_period_row(db_session, ind_canonical_id, 30, date(2026, 1, 1))
    _create_credit_period_row(db_session, uae_canonical_id, 45, date(2026, 1, 1))

    resp = client.get("/config/credit-period?entity_code=IND")
    assert resp.status_code == 200
    body = resp.json()
    for item in body["items"]:
        assert item["entity_code"] == "IND"


# ---------------------------------------------------------------------------
# Test 3: GET — include_closed=false filters open rows only
# ---------------------------------------------------------------------------


def test_get_credit_periods_include_closed_false(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "ClosedFilterParty")
    _create_credit_period_row(
        db_session, canonical_id, 30, date(2026, 1, 1), valid_to=date(2026, 6, 30)
    )

    # Get without include_closed
    resp = client.get("/config/credit-period?entity_code=IND")
    assert resp.status_code == 200
    for item in resp.json()["items"]:
        assert item["valid_to"] is None


# ---------------------------------------------------------------------------
# Test 4: POST — creates new row, no prior open row
# ---------------------------------------------------------------------------


def test_post_credit_period_no_prior_row(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "NewCPParty")

    resp = client.post(
        "/config/credit-period",
        json={
            "canonical_id": str(canonical_id),
            "credit_days": 45,
            "valid_from": "2026-01-01",
        },
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["credit_days"] == 45
    assert body["valid_to"] is None
    assert body["canonical_id"] == str(canonical_id)


# ---------------------------------------------------------------------------
# Test 5: POST — creates new row and closes prior open row
# ---------------------------------------------------------------------------


def test_post_credit_period_closes_prior_open_row(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "ClosePriorParty")
    prior_id = _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.post(
        "/config/credit-period",
        json={
            "canonical_id": str(canonical_id),
            "credit_days": 60,
            "valid_from": "2026-04-01",
            "reason_note": "New contract terms",
        },
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    assert resp.json()["credit_days"] == 60
    assert resp.json()["valid_to"] is None

    # Prior row should now be closed
    db_session.expire_all()
    prior = db_session.get(CreditPeriodConfig, prior_id)
    assert prior is not None
    assert prior.valid_to is not None
    # valid_to = new valid_from - 1 day = 2026-03-31
    assert prior.valid_to == date(2026, 3, 31)


# ---------------------------------------------------------------------------
# Test 6: PATCH — update open row (ADMIN)
# ---------------------------------------------------------------------------


def test_patch_credit_period_open_row(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "PatchOpenParty")
    cfg_id = _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.patch(
        f"/config/credit-period/{cfg_id}",
        json={"credit_days": 45, "reason_note": "Updated reason"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["credit_days"] == 45
    assert body["reason_note"] == "Updated reason"


# ---------------------------------------------------------------------------
# Test 7: PATCH — closed row → 409
# ---------------------------------------------------------------------------


def test_patch_credit_period_closed_row_409(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "PatchClosedParty")
    cfg_id = _create_credit_period_row(
        db_session, canonical_id, 30, date(2026, 1, 1), valid_to=date(2026, 3, 31)
    )

    resp = client.patch(
        f"/config/credit-period/{cfg_id}",
        json={"credit_days": 45},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "CREDIT_PERIOD_ROW_CLOSED"


# ---------------------------------------------------------------------------
# Test 8: DELETE → 405
# ---------------------------------------------------------------------------


def test_delete_credit_period_returns_405(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "DeleteCPParty")
    cfg_id = _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.delete(
        f"/config/credit-period/{cfg_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 405


# ---------------------------------------------------------------------------
# Test 9: RBAC — analyst own entity can POST
# ---------------------------------------------------------------------------


def test_post_credit_period_analyst_own_entity(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst.cp@emb.global", entity_code="IND")
    canonical_id = _create_canonical(db_session, "IND", "AnalystCPParty")

    resp = client.post(
        "/config/credit-period",
        json={
            "canonical_id": str(canonical_id),
            "credit_days": 30,
            "valid_from": "2026-01-01",
        },
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201, resp.json()


# ---------------------------------------------------------------------------
# Test 10: RBAC — analyst wrong entity → 403 on POST
# ---------------------------------------------------------------------------


def test_post_credit_period_analyst_wrong_entity_403(
    client: TestClient, db_session: Session
) -> None:
    # Create canonical in IND
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "WrongEntityCPParty")

    # Login as UAE analyst
    _login_as_analyst(client, db_session, "analyst.uae.cp@emb.global", entity_code="UAE")
    resp = client.post(
        "/config/credit-period",
        json={
            "canonical_id": str(canonical_id),
            "credit_days": 30,
            "valid_from": "2026-01-01",
        },
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 11: RBAC — CFO can read
# ---------------------------------------------------------------------------


def test_get_credit_periods_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "CFOReadCPParty")
    _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    _login_as_cfo(client, db_session, "cfo.cp@emb.global")
    resp = client.get("/config/credit-period")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Test 12: RBAC — PENDING → 403 on GET
# ---------------------------------------------------------------------------


def test_get_credit_periods_pending_403(client: TestClient, db_session: Session) -> None:
    _login_as_pending(client, "pending.cp@emb.global")
    resp = client.get("/config/credit-period")
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 13: RBAC — PATCH credit-period — analyst → 403
# ---------------------------------------------------------------------------


def test_patch_credit_period_analyst_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AnalystPatchCPParty")
    cfg_id = _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    _login_as_analyst(client, db_session, "analyst.patch.cp@emb.global", entity_code="IND")
    resp = client.patch(
        f"/config/credit-period/{cfg_id}",
        json={"credit_days": 45},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 14: Audit log written on POST
# ---------------------------------------------------------------------------


def test_post_credit_period_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AuditLogCPParty")

    resp = client.post(
        "/config/credit-period",
        json={
            "canonical_id": str(canonical_id),
            "credit_days": 30,
            "valid_from": "2026-01-01",
        },
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201
    config_id = uuid.UUID(resp.json()["id"])

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "credit_period_config.create",
            AuditLog.entity_id == config_id,
        )
    )
    assert audit is not None
    assert audit.after["credit_days"] == 30
    assert audit.after["canonical_id"] == str(canonical_id)


# ---------------------------------------------------------------------------
# Test 15: Audit log written on PATCH
# ---------------------------------------------------------------------------


def test_patch_credit_period_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AuditPatchCPParty")
    cfg_id = _create_credit_period_row(db_session, canonical_id, 30, date(2026, 1, 1))

    resp = client.patch(
        f"/config/credit-period/{cfg_id}",
        json={"credit_days": 90},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "credit_period_config.update",
            AuditLog.entity_id == cfg_id,
        )
    )
    assert audit is not None
    assert audit.before["credit_days"] == 30
    assert audit.after["credit_days"] == 90
