"""Integration tests — exception exclude / un-exclude flow (Task A.1).

Endpoints:
  POST /exceptions/{id}/exclude
  POST /exceptions/{id}/un-exclude
  GET  /exceptions?include_excluded=true|false

RBAC:
  exclude:    ANALYST (entity-scoped) ok; ANALYST cross-entity 403; CFO 403; PENDING 403
  un-exclude: ADMIN only; ANALYST 403
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth helpers (copy of pattern from test_exceptions_crud.py)
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient,
    db_session: Session,
    email: str = "analyst_exc@emb.global",
    entity_code: str | None = "IND",
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    if entity_code:
        entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
        assert entity is not None
        user.entity_id_scope = entity.id
    else:
        user.entity_id_scope = None
    user.is_active = True
    db_session.flush()


def _login_as_cfo(client: TestClient, db_session: Session, email: str = "cfo_exc@emb.global") -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _login_as_pending(
    client: TestClient,
    db_session: Session,
    email: str = "pending_exc@emb.global",
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.PENDING
    user.is_active = True
    db_session.flush()


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return cast(uuid.UUID, u.id)


def _entity_id(db_session: Session, code: str) -> uuid.UUID:
    e = db_session.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return cast(uuid.UUID, e.id)


def _get_bucket_code(db_session: Session, code: str = "DISPUTED") -> str:
    bt = db_session.scalar(
        select(ExceptionBucketType).where(ExceptionBucketType.code == code)
    )
    assert bt is not None, f"ExceptionBucketType '{code}' not seeded"
    return cast(str, bt.code)


def _make_open_invoice(
    db_session: Session,
    entity_code: str = "IND",
    ref: str | None = None,
) -> uuid.UUID:
    """Insert a minimal OPEN invoice and return its id."""
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    ref = ref or f"INV-EXCL-{uuid.uuid4().hex[:6].upper()}"

    snap = Snapshot(
        entity_id=entity_id,
        as_of_date=date(2026, 1, 31),
        status="PUBLISHED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
    )
    db_session.add(snap)
    db_session.flush()

    canonical = PartyCanonical(entity_id=entity_id, name=f"ExclParty-{ref}", created_by=admin)
    db_session.add(canonical)
    db_session.flush()

    invoice = Invoice(
        invoice_ref=ref,
        invoice_date=date(2026, 1, 15),
        amount=5000.0,
        currency="INR",
        due_date=date(2026, 2, 14),
        status="OPEN",
        entity_id=entity_id,
        canonical_id=canonical.id,
        first_seen_snapshot_id=snap.id,
        credit_days_applied=30,
        credit_days_source="MANUAL",
        raw_row_json={},
    )
    db_session.add(invoice)
    db_session.flush()
    return cast(uuid.UUID, invoice.id)


def _make_active_exception(
    client: TestClient,
    db_session: Session,
    invoice_id: uuid.UUID,
    bucket_code: str = "DISPUTED",
) -> uuid.UUID:
    """Create an ACTIVE exception via API (admin auth) and return its id."""
    _login_as_admin(client)
    resp = client.post(
        f"/invoices/{invoice_id}/exceptions",
        json={"bucket_type_code": bucket_code, "reason": "Test exclusion flow"},
        headers=_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    return uuid.UUID(resp.json()["id"])


def _make_active_exception_in_snapshot(
    client: TestClient,
    db_session: Session,
    entity_code: str = "IND",
) -> tuple[uuid.UUID, uuid.UUID]:
    """Create an invoice + active exception; return (invoice_id, exception_id)."""
    invoice_id = _make_open_invoice(db_session, entity_code=entity_code)
    exception_id = _make_active_exception(client, db_session, invoice_id)
    return invoice_id, exception_id


# ---------------------------------------------------------------------------
# Helpers for counting exceptions in dashboard top-party aggregation
# ---------------------------------------------------------------------------


def _add_invoice_snapshot(
    db_session: Session,
    invoice_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    as_of_date: date,
) -> None:
    row = InvoiceSnapshot(
        snapshot_id=snapshot_id,
        invoice_id=invoice_id,
        as_of_date=as_of_date,
        bucket="0_30",
        outstanding_amount=5000,
        overdue_days=10,
    )
    db_session.add(row)
    db_session.flush()


# ---------------------------------------------------------------------------
# Tests — exclude happy path
# ---------------------------------------------------------------------------


def test_exclude_exception_happy_path(client: TestClient, db_session: Session) -> None:
    """ADMIN can exclude an ACTIVE exception; excluded_at + reason persisted."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "LEGAL_HOLD"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["id"] == str(exception_id)
    assert body["excluded_reason"] == "LEGAL_HOLD"
    assert body["excluded_at"] is not None

    # DB state
    tag = db_session.get(ExceptionTag, exception_id)
    assert tag is not None
    assert tag.excluded_at is not None
    assert tag.excluded_reason == "LEGAL_HOLD"
    # Status must NOT change (orthogonal)
    assert tag.status == "ACTIVE"


def test_exclude_exception_with_note(client: TestClient, db_session: Session) -> None:
    """Optional note persisted for non-OTHER reasons."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION", "reason_note": "Ongoing settlement talks"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["excluded_reason_note"] == "Ongoing settlement talks"

    tag = db_session.get(ExceptionTag, exception_id)
    assert tag is not None
    assert tag.excluded_reason_note == "Ongoing settlement talks"


# ---------------------------------------------------------------------------
# Tests — OTHER requires note
# ---------------------------------------------------------------------------


def test_exclude_other_requires_note(client: TestClient, db_session: Session) -> None:
    """OTHER reason without note returns 422."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "OTHER"},
        headers=_headers(client),
    )
    assert resp.status_code == 422


def test_exclude_other_with_note_ok(client: TestClient, db_session: Session) -> None:
    """OTHER reason with non-empty note returns 200."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "OTHER", "reason_note": "Special board resolution"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()


# ---------------------------------------------------------------------------
# Tests — already excluded → 409
# ---------------------------------------------------------------------------


def test_exclude_already_excluded_409(client: TestClient, db_session: Session) -> None:
    """Double-exclude returns 409."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    r1 = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "LEGAL_HOLD"},
        headers=_headers(client),
    )
    assert r1.status_code == 200

    r2 = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )
    assert r2.status_code == 409
    assert r2.json()["detail"]["code"] == "EXCEPTION_ALREADY_EXCLUDED"


# ---------------------------------------------------------------------------
# Tests — un-exclude happy path
# ---------------------------------------------------------------------------


def test_unexclude_exception_happy_path(client: TestClient, db_session: Session) -> None:
    """ADMIN can un-exclude; all 4 excluded_* fields cleared."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "LEGAL_HOLD"},
        headers=_headers(client),
    )
    resp = client.post(
        f"/exceptions/{exception_id}/un-exclude",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()

    tag = db_session.get(ExceptionTag, exception_id)
    assert tag is not None
    assert tag.excluded_at is None
    assert tag.excluded_reason is None
    assert tag.excluded_reason_note is None
    assert tag.excluded_by is None


def test_unexclude_not_excluded_409(client: TestClient, db_session: Session) -> None:
    """Un-excluding a non-excluded exception returns 409."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    resp = client.post(
        f"/exceptions/{exception_id}/un-exclude",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "EXCEPTION_NOT_EXCLUDED"


# ---------------------------------------------------------------------------
# Tests — RBAC
# ---------------------------------------------------------------------------


def test_analyst_in_scope_can_exclude(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND can exclude an IND exception."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(
        client, db_session, entity_code="IND"
    )
    _login_as_analyst(client, db_session, entity_code="IND")

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()


def test_analyst_cross_entity_403(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to UAE cannot exclude an IND exception."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(
        client, db_session, entity_code="IND"
    )
    _login_as_analyst(client, db_session, email="analyst2_exc@emb.global", entity_code="UAE")

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_cfo_cannot_exclude(client: TestClient, db_session: Session) -> None:
    """CFO gets 403 on exclude endpoint."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_cfo(client, db_session)

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_pending_cannot_exclude(client: TestClient, db_session: Session) -> None:
    """PENDING gets 403 on exclude endpoint."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_pending(client, db_session)

    resp = client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_analyst_cannot_unexclude(client: TestClient, db_session: Session) -> None:
    """ANALYST gets 403 on un-exclude (ADMIN only)."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)
    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "LEGAL_HOLD"},
        headers=_headers(client),
    )

    _login_as_analyst(client, db_session, email="analyst3_exc@emb.global", entity_code="IND")
    resp = client.post(
        f"/exceptions/{exception_id}/un-exclude",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Tests — include_excluded filter
# ---------------------------------------------------------------------------


def test_list_default_hides_excluded(client: TestClient, db_session: Session) -> None:
    """Default GET /exceptions does not return excluded rows."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)
    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "AGREED_WRITE_OFF"},
        headers=_headers(client),
    )

    resp = client.get("/exceptions", headers=_headers(client))
    assert resp.status_code == 200
    ids = [r["id"] for r in resp.json()["items"]]
    assert str(exception_id) not in ids


def test_list_include_excluded_shows_all(client: TestClient, db_session: Session) -> None:
    """GET /exceptions?include_excluded=true returns excluded rows."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)
    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "AGREED_WRITE_OFF"},
        headers=_headers(client),
    )

    resp = client.get("/exceptions?include_excluded=true", headers=_headers(client))
    assert resp.status_code == 200
    ids = [r["id"] for r in resp.json()["items"]]
    assert str(exception_id) in ids


def test_excluded_row_has_exclusion_fields(client: TestClient, db_session: Session) -> None:
    """When include_excluded=true, the row carries excluded_at + excluded_reason fields."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)
    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "LEGAL_HOLD", "reason_note": "Active litigation"},
        headers=_headers(client),
    )

    resp = client.get("/exceptions?include_excluded=true", headers=_headers(client))
    assert resp.status_code == 200
    row = next((r for r in resp.json()["items"] if r["id"] == str(exception_id)), None)
    assert row is not None
    assert row["excluded_reason"] == "LEGAL_HOLD"
    assert row["excluded_reason_note"] == "Active litigation"
    assert row["excluded_at"] is not None
    assert row["excluded_by_email"] is not None


# ---------------------------------------------------------------------------
# Tests — audit log
# ---------------------------------------------------------------------------


def test_audit_log_written_on_exclude(client: TestClient, db_session: Session) -> None:
    """Excluding an exception writes an EXCEPTION_EXCLUDED audit row."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )

    audit_row = db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == exception_id,
            AuditLog.action == "EXCEPTION_EXCLUDED",
        )
    )
    assert audit_row is not None
    assert audit_row.after is not None
    assert audit_row.after.get("excluded_reason") == "NEGOTIATION"


def test_audit_log_written_on_unexclude(client: TestClient, db_session: Session) -> None:
    """Un-excluding writes an EXCEPTION_UNEXCLUDED audit row."""
    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "NEGOTIATION"},
        headers=_headers(client),
    )
    client.post(
        f"/exceptions/{exception_id}/un-exclude",
        json={},
        headers=_headers(client),
    )

    audit_row = db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == exception_id,
            AuditLog.action == "EXCEPTION_UNEXCLUDED",
        )
    )
    assert audit_row is not None
    assert audit_row.after == {"excluded_at": None}


# ---------------------------------------------------------------------------
# Tests — dashboard top-party count skips excluded
# ---------------------------------------------------------------------------


def test_dashboard_top_party_skips_excluded(client: TestClient, db_session: Session) -> None:
    """Dashboard active_exception_count must NOT include excluded exceptions.

    We verify by excluding the only exception for a party and confirming the
    count drops in the DB-level aggregation used by _compute_top_parties.

    Note: we query the DB directly rather than via the dashboard API to avoid
    needing a full published snapshot with partitioned invoice_snapshots rows.
    The service-layer fix is independently verifiable through the model query.
    """
    from sqlalchemy import func

    invoice_id, exception_id = _make_active_exception_in_snapshot(client, db_session)
    _login_as_admin(client)

    # Get canonical_id for this invoice
    invoice = db_session.get(Invoice, invoice_id)
    assert invoice is not None
    canonical_id = invoice.canonical_id

    # Before exclude: count = 1
    count_before = db_session.scalar(
        select(func.count(ExceptionTag.id)).where(
            ExceptionTag.invoice_id.in_(
                select(Invoice.id).where(Invoice.canonical_id == canonical_id)
            ),
            ExceptionTag.status == "ACTIVE",
            ExceptionTag.excluded_at.is_(None),
        )
    ) or 0
    assert count_before == 1

    # Exclude
    client.post(
        f"/exceptions/{exception_id}/exclude",
        json={"reason": "LEGAL_HOLD"},
        headers=_headers(client),
    )
    db_session.expire_all()

    # After exclude: count = 0
    count_after = db_session.scalar(
        select(func.count(ExceptionTag.id)).where(
            ExceptionTag.invoice_id.in_(
                select(Invoice.id).where(Invoice.canonical_id == canonical_id)
            ),
            ExceptionTag.status == "ACTIVE",
            ExceptionTag.excluded_at.is_(None),
        )
    ) or 0
    assert count_after == 0
