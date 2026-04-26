"""Integration tests for exception tags CRUD (M5 Group C).

Endpoints:
  POST /invoices/:id/exceptions
  PATCH /exceptions/:id
  GET  /exceptions

RBAC: ANALYST and ADMIN can write; CFO can read only.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.follow_up import FollowUp
from app.db.models.invoice import Invoice
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
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
    email: str = "analyst@emb.global",
    entity_code: str | None = None,
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


def _login_as_cfo(client: TestClient, db_session: Session, email: str = "cfo@emb.global") -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


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


def _get_bucket_id(db_session: Session, code: str = "DISPUTED") -> uuid.UUID:
    bt = db_session.scalar(
        select(ExceptionBucketType).where(
            ExceptionBucketType.code == code,
            ExceptionBucketType.active.is_(True),
        )
    )
    assert bt is not None, f"ExceptionBucketType '{code}' not seeded or inactive"
    return cast(uuid.UUID, bt.id)


def _get_bucket_code(db_session: Session, code: str = "DISPUTED") -> str:
    bt = db_session.scalar(select(ExceptionBucketType).where(ExceptionBucketType.code == code))
    assert bt is not None, f"ExceptionBucketType '{code}' not seeded"
    return cast(str, bt.code)


def _make_open_invoice(
    db_session: Session,
    entity_code: str = "IND",
    ref: str = "INV-EX-001",
    amount: float = 5000.0,
    invoice_date: date = date(2026, 1, 15),
) -> uuid.UUID:
    """Insert a minimal OPEN invoice directly."""
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)

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

    canonical = PartyCanonical(entity_id=entity_id, name=f"TestParty-{ref}", created_by=admin)
    db_session.add(canonical)
    db_session.flush()

    invoice = Invoice(
        invoice_ref=ref,
        invoice_date=invoice_date,
        amount=amount,
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


def _make_settled_invoice(
    db_session: Session,
    entity_code: str = "IND",
    ref: str = "INV-SETTLED-001",
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)

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

    canonical = PartyCanonical(entity_id=entity_id, name=f"SettledParty-{ref}", created_by=admin)
    db_session.add(canonical)
    db_session.flush()
    invoice = Invoice(
        invoice_ref=ref,
        invoice_date=date(2026, 1, 15),
        amount=1000.0,
        currency="INR",
        due_date=date(2026, 2, 14),
        status="SETTLED",
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


def _post_exception(
    client: TestClient,
    invoice_id: uuid.UUID,
    bucket_type_code: str,
    reason: str = "Customer dispute",
    expected_resolution_date: str | None = None,
) -> Any:
    body: dict[str, Any] = {"bucket_type_code": bucket_type_code, "reason": reason}
    if expected_resolution_date:
        body["expected_resolution_date"] = expected_resolution_date
    return client.post(
        f"/invoices/{invoice_id}/exceptions",
        json=body,
        headers=_headers(client),
    )


# ---------------------------------------------------------------------------
# POST /invoices/:id/exceptions
# ---------------------------------------------------------------------------


def test_create_exception_201_on_open_invoice(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-A01")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code)
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["invoice_id"] == str(invoice_id)
    assert body["status"] == "ACTIVE"
    assert body["bucket_type_code"] == "DISPUTED"


def test_create_exception_with_expected_resolution_date(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-A02")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code, expected_resolution_date="2026-04-30")
    assert resp.status_code == 201, resp.json()
    assert resp.json()["expected_resolution_date"] == "2026-04-30"


def test_create_exception_409_on_settled_invoice(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_settled_invoice(db_session, ref="INV-EX-A03")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code)
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "INVOICE_NOT_OPEN"


def test_create_exception_requires_non_empty_reason(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-A04")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code, reason="   ")
    assert resp.status_code == 422


def test_create_exception_404_on_unknown_invoice(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    bucket_code = _get_bucket_code(db_session, "DISPUTED")
    fake_id = uuid.uuid4()

    resp = _post_exception(client, fake_id, bucket_code)
    assert resp.status_code == 404


def test_create_exception_400_inactive_bucket(client: TestClient, db_session: Session) -> None:
    """Using an inactive bucket type should be rejected."""
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-A05")

    # Create an inactive bucket
    inactive_bt = ExceptionBucketType(
        code="INACTIVE_TEST",
        name="Inactive",
        active=False,
    )
    db_session.add(inactive_bt)
    db_session.flush()

    resp = _post_exception(client, invoice_id, inactive_bt.code)
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "BUCKET_TYPE_INACTIVE"


def test_create_exception_analyst_can_create(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code=None)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-A06")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code)
    assert resp.status_code == 201, resp.json()


def test_create_exception_cfo_forbidden(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-A07")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code)
    assert resp.status_code == 403


def test_create_exception_analyst_out_of_scope_403(client: TestClient, db_session: Session) -> None:
    """Analyst scoped to UAE cannot tag IND invoices."""
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="UAE")
    invoice_id = _make_open_invoice(db_session, entity_code="IND", ref="INV-EX-A08")
    bucket_code = _get_bucket_code(db_session, "DISPUTED")

    resp = _post_exception(client, invoice_id, bucket_code)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# PATCH /exceptions/:id
# ---------------------------------------------------------------------------


def _create_active_tag(
    db_session: Session,
    invoice_id: uuid.UUID,
    bucket_code: str = "DISPUTED",
) -> uuid.UUID:
    admin = _admin_id(db_session)
    bucket_id = _get_bucket_id(db_session, bucket_code)
    tag = ExceptionTag(
        invoice_id=invoice_id,
        bucket_type_id=bucket_id,
        reason="Test reason",
        tagged_by=admin,
        status="ACTIVE",
    )
    db_session.add(tag)
    db_session.flush()
    return cast(uuid.UUID, tag.id)


def test_resolve_exception_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-P01")
    tag_id = _create_active_tag(db_session, invoice_id)

    resp = client.patch(
        f"/exceptions/{tag_id}",
        json={"action": "RESOLVE", "resolution_note": "Paid in full"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["status"] == "RESOLVED"
    assert body["resolution_note"] == "Paid in full"
    assert body["resolved_at"] is not None


def test_resolve_already_resolved_409(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-P02")
    tag_id = _create_active_tag(db_session, invoice_id)

    # Resolve first time
    client.patch(
        f"/exceptions/{tag_id}",
        json={"action": "RESOLVE", "resolution_note": "First"},
        headers=_headers(client),
    )

    # Resolve second time
    resp = client.patch(
        f"/exceptions/{tag_id}",
        json={"action": "RESOLVE", "resolution_note": "Second"},
        headers=_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "EXCEPTION_ALREADY_RESOLVED"


def test_update_note_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-P03")
    tag_id = _create_active_tag(db_session, invoice_id)

    resp = client.patch(
        f"/exceptions/{tag_id}",
        json={"action": "UPDATE_NOTE", "note": "Updated note"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["note"] == "Updated note"
    assert resp.json()["status"] == "ACTIVE"


def test_update_expected_resolution_date_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-P04")
    tag_id = _create_active_tag(db_session, invoice_id)

    resp = client.patch(
        f"/exceptions/{tag_id}",
        json={
            "action": "UPDATE_EXPECTED_RESOLUTION_DATE",
            "expected_resolution_date": "2026-06-30",
        },
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["expected_resolution_date"] == "2026-06-30"


def test_patch_exception_404_unknown(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    fake_id = uuid.uuid4()
    resp = client.patch(
        f"/exceptions/{fake_id}",
        json={"action": "RESOLVE", "resolution_note": "N/A"},
        headers=_headers(client),
    )
    assert resp.status_code == 404


def test_patch_exception_cfo_forbidden(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-P05")
    tag_id = _create_active_tag(db_session, invoice_id)

    resp = client.patch(
        f"/exceptions/{tag_id}",
        json={"action": "RESOLVE", "resolution_note": "N/A"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /exceptions
# ---------------------------------------------------------------------------


def test_list_exceptions_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-L01")
    _create_active_tag(db_session, invoice_id, "DISPUTED")

    resp = client.get("/exceptions")
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert isinstance(body["items"], list)


def test_list_exceptions_filter_by_status(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-L02")
    _create_active_tag(db_session, invoice_id, "DISPUTED")

    resp = client.get("/exceptions?status=ACTIVE")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["status"] == "ACTIVE" for i in items)


def test_list_exceptions_filter_by_invoice_id(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-EX-L03")
    _create_active_tag(db_session, invoice_id)

    resp = client.get(f"/exceptions?invoice_id={invoice_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["invoice_id"] == str(invoice_id) for i in items)


def test_list_exceptions_analyst_scoped(client: TestClient, db_session: Session) -> None:
    """Analyst scoped to IND can only see IND exceptions."""
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="IND")
    invoice_id_ind = _make_open_invoice(db_session, entity_code="IND", ref="INV-EX-L04")
    invoice_id_uae = _make_open_invoice(db_session, entity_code="UAE", ref="INV-EX-L05")
    _create_active_tag(db_session, invoice_id_ind)
    _create_active_tag(db_session, invoice_id_uae)

    resp = client.get("/exceptions")
    assert resp.status_code == 200
    items = resp.json()["items"]
    invoice_ids = {i["invoice_id"] for i in items}
    assert str(invoice_id_ind) in invoice_ids
    assert str(invoice_id_uae) not in invoice_ids


def test_list_exceptions_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = client.get("/exceptions")
    assert resp.status_code == 200


def test_list_exceptions_pagination(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    for i in range(3):
        iid = _make_open_invoice(db_session, ref=f"INV-EX-PAG-{i:02d}")
        _create_active_tag(db_session, iid)

    resp = client.get("/exceptions?page=1&page_size=2")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) <= 2
    assert body["page"] == 1
    assert body["page_size"] == 2


# ---------------------------------------------------------------------------
# Task 14 — last_follow_up_date / last_follow_up_channel on ExceptionListRow
# ---------------------------------------------------------------------------


def _get_canonical_id_for_invoice(db_session: Session, invoice_id: uuid.UUID) -> uuid.UUID:
    inv = db_session.get(Invoice, invoice_id)
    assert inv is not None
    return cast(uuid.UUID, inv.canonical_id)


def _add_follow_up(
    db_session: Session,
    canonical_id: uuid.UUID,
    follow_up_date: date,
    channel: str = "EMAIL",
    invoice_id: uuid.UUID | None = None,
) -> None:
    admin = _admin_id(db_session)
    fu = FollowUp(
        canonical_id=canonical_id,
        date=follow_up_date,
        channel=channel,
        logged_by=admin,
        invoice_id=invoice_id,
    )
    db_session.add(fu)
    db_session.flush()


def test_exception_list_last_follow_up_populated_canonical(
    client: TestClient, db_session: Session
) -> None:
    """last_follow_up_date/channel are populated when a canonical-level follow-up exists."""
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-FU-EX-C01")
    _create_active_tag(db_session, invoice_id)
    canonical_id = _get_canonical_id_for_invoice(db_session, invoice_id)

    # Add a canonical-level follow-up
    _add_follow_up(db_session, canonical_id, date(2026, 3, 25), channel="WHATSAPP")

    resp = client.get(f"/exceptions?invoice_id={invoice_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = next(i for i in items if i["invoice_id"] == str(invoice_id))
    assert (
        row["last_follow_up_date"] == "2026-03-25"
    ), f"Expected 2026-03-25, got {row['last_follow_up_date']}"
    assert (
        row["last_follow_up_channel"] == "WHATSAPP"
    ), f"Expected WHATSAPP, got {row['last_follow_up_channel']}"


def test_exception_list_last_follow_up_none_when_absent(
    client: TestClient, db_session: Session
) -> None:
    """last_follow_up_date/channel are None when no follow-up exists."""
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-FU-EX-N01")
    _create_active_tag(db_session, invoice_id)

    # No follow-up seeded

    resp = client.get(f"/exceptions?invoice_id={invoice_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = next(i for i in items if i["invoice_id"] == str(invoice_id))
    assert row["last_follow_up_date"] is None, f"Expected None, got {row['last_follow_up_date']}"
    assert (
        row["last_follow_up_channel"] is None
    ), f"Expected None, got {row['last_follow_up_channel']}"


def test_exception_list_invoice_follow_up_preferred_over_canonical(
    client: TestClient, db_session: Session
) -> None:
    """Invoice-scoped follow-up is preferred over canonical-scoped when both exist."""
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, ref="INV-FU-EX-P01")
    _create_active_tag(db_session, invoice_id)
    canonical_id = _get_canonical_id_for_invoice(db_session, invoice_id)

    # Canonical-level follow-up (older)
    _add_follow_up(db_session, canonical_id, date(2026, 2, 10), channel="EMAIL")
    # Invoice-level follow-up (newer date, but invoice-scoped takes priority)
    _add_follow_up(
        db_session, canonical_id, date(2026, 3, 10), channel="CALL", invoice_id=invoice_id
    )

    resp = client.get(f"/exceptions?invoice_id={invoice_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    row = next(i for i in items if i["invoice_id"] == str(invoice_id))
    # Invoice-scoped CALL (2026-03-10) wins over canonical EMAIL (2026-02-10)
    assert (
        row["last_follow_up_channel"] == "CALL"
    ), f"Expected CALL (invoice-scoped), got {row['last_follow_up_channel']}"
    assert row["last_follow_up_date"] == "2026-03-10"
