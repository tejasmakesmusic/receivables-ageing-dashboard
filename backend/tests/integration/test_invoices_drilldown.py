"""Integration tests for GET /invoices and GET /invoices/:id (M4 Group A).

Covers: list with filters (entity, status, bucket, has_active_exceptions),
detail endpoint, snapshot history, exception tag display, RBAC.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.rbac import Role
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
# Auth helpers
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token", "")


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
        e = db_session.scalar(select(Entity).where(Entity.code == entity_code))
        assert e is not None
        user.entity_id_scope = e.id
    else:
        user.entity_id_scope = None
    user.is_active = True
    db_session.flush()


def _login_as_cfo(
    client: TestClient, db_session: Session, email: str = "cfo@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return u.id


def _entity_id(db_session: Session, code: str = "IND") -> uuid.UUID:
    e = db_session.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return e.id


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _make_invoice(
    db_session: Session,
    entity_code: str = "IND",
    ref: str = "INV-DR-001",
    status: str = "OPEN",
    amount: float = 5000.0,
    invoice_date: date = date(2026, 1, 15),
    with_snapshot: bool = False,
    bucket: str = "NOT_DUE",
    overdue_days: int = 0,
    credit_days_source: str = "DEFAULT",
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    canonical = PartyCanonical(entity_id=entity_id, name=f"Party-{ref}", created_by=admin)
    db_session.add(canonical)
    db_session.flush()

    invoice = Invoice(
        invoice_ref=ref,
        invoice_date=invoice_date,
        amount=amount,
        currency="INR" if entity_code == "IND" else "AED",
        due_date=date(2026, 2, 14),
        status=status,
        entity_id=entity_id,
        canonical_id=canonical.id,
        credit_days_source=credit_days_source,
    )
    db_session.add(invoice)
    db_session.flush()

    if with_snapshot:
        snap = Snapshot(
            entity_id=entity_id,
            as_of_date=date(2026, 3, 31),
            status="PUBLISHED",
            source="TALLY",
            uploaded_by=admin,
        )
        db_session.add(snap)
        db_session.flush()
        invoice.first_seen_snapshot_id = snap.id
        inv_snap = InvoiceSnapshot(
            snapshot_id=snap.id,
            invoice_id=invoice.id,
            as_of_date=date(2026, 3, 31),
            outstanding_amount=Decimal(str(amount)),
            overdue_days=overdue_days,
            bucket=bucket,
        )
        db_session.add(inv_snap)
        db_session.flush()

    return invoice.id


def _add_active_exception(db_session: Session, invoice_id: uuid.UUID) -> uuid.UUID:
    admin = _admin_id(db_session)
    bt = db_session.scalar(
        select(ExceptionBucketType).where(ExceptionBucketType.is_active.is_(True))
    )
    assert bt is not None
    tag = ExceptionTag(
        invoice_id=invoice_id,
        bucket_type_id=bt.id,
        reason="Test exception",
        tagged_by=admin,
        status="ACTIVE",
    )
    db_session.add(tag)
    db_session.flush()
    return tag.id


# ---------------------------------------------------------------------------
# GET /invoices (list)
# ---------------------------------------------------------------------------


def test_list_invoices_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_invoice(db_session, ref="LIST-001")
    resp = client.get("/invoices")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body


def test_list_invoices_200_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/invoices")
    assert resp.status_code == 200


def test_list_invoices_200_cfo(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = client.get("/invoices")
    assert resp.status_code == 200


def test_list_invoices_filter_by_entity(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_invoice(db_session, entity_code="IND", ref="LIST-E-IND")
    _make_invoice(db_session, entity_code="UAE", ref="LIST-E-UAE")

    resp = client.get("/invoices?entity=IND")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["entity_code"] == "IND" for i in items)


def test_list_invoices_filter_by_status(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_invoice(db_session, status="OPEN", ref="LIST-S-OPEN")
    _make_invoice(db_session, status="SETTLED", ref="LIST-S-SETTLED")

    resp = client.get("/invoices?status=OPEN")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["status"] == "OPEN" for i in items)


def test_list_invoices_filter_has_active_exceptions(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    inv_with = _make_invoice(db_session, ref="LIST-EX-WITH")
    inv_without = _make_invoice(db_session, ref="LIST-EX-WITHOUT")
    _add_active_exception(db_session, inv_with)

    resp = client.get("/invoices?has_active_exceptions=true")
    assert resp.status_code == 200
    items = resp.json()["items"]
    ids = {i["invoice_id"] for i in items}
    assert str(inv_with) in ids
    assert str(inv_without) not in ids


def test_list_invoices_filter_by_party_canonical_id(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    inv_id = _make_invoice(db_session, ref="LIST-PARTY-001")
    invoice = db_session.get(Invoice, inv_id)
    assert invoice is not None
    canonical_id = invoice.canonical_id

    resp = client.get(f"/invoices?party_canonical_id={canonical_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["canonical_id"] == str(canonical_id) for i in items)


def test_list_invoices_analyst_entity_scope(
    client: TestClient, db_session: Session
) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="IND")
    _make_invoice(db_session, entity_code="IND", ref="LIST-SC-IND")
    _make_invoice(db_session, entity_code="UAE", ref="LIST-SC-UAE")

    resp = client.get("/invoices")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["entity_code"] == "IND" for i in items)


def test_list_invoices_pagination(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    for i in range(5):
        _make_invoice(db_session, ref=f"LIST-PAGE-{i:03d}")

    resp = client.get("/invoices?page=1&page_size=2")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) <= 2


# ---------------------------------------------------------------------------
# GET /invoices/:id (detail)
# ---------------------------------------------------------------------------


def test_get_invoice_detail_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    inv_id = _make_invoice(db_session, ref="DETAIL-001")
    resp = client.get(f"/invoices/{inv_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["invoice_id"] == str(inv_id)
    assert body["invoice_ref"] == "DETAIL-001"


def test_get_invoice_detail_404(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.get(f"/invoices/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_invoice_detail_includes_exception_tags(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    inv_id = _make_invoice(db_session, ref="DETAIL-EX-001")
    _add_active_exception(db_session, inv_id)

    resp = client.get(f"/invoices/{inv_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert "exception_tags" in body
    assert len(body["exception_tags"]) == 1
    tag = body["exception_tags"][0]
    assert tag["status"] == "ACTIVE"
    assert tag["bucket_type_code"] != ""


def test_get_invoice_detail_includes_snapshot_history(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    inv_id = _make_invoice(db_session, ref="DETAIL-HIST-001", with_snapshot=True)

    resp = client.get(f"/invoices/{inv_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert "snapshot_history" in body
    assert len(body["snapshot_history"]) >= 1
    hist = body["snapshot_history"][0]
    assert "as_of_date" in hist
    assert "outstanding_amount" in hist
    assert "bucket" in hist


def test_get_invoice_detail_analyst_can_read(
    client: TestClient, db_session: Session
) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    inv_id = _make_invoice(db_session, ref="DETAIL-AN-001")
    resp = client.get(f"/invoices/{inv_id}")
    assert resp.status_code == 200


def test_get_invoice_detail_analyst_scoped_403(
    client: TestClient, db_session: Session
) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="IND")
    uae_inv_id = _make_invoice(db_session, entity_code="UAE", ref="DETAIL-SCOPE-403")
    resp = client.get(f"/invoices/{uae_inv_id}")
    assert resp.status_code == 403


def test_get_invoice_detail_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    inv_id = _make_invoice(db_session, ref="DETAIL-CFO-001")
    resp = client.get(f"/invoices/{inv_id}")
    assert resp.status_code == 200
