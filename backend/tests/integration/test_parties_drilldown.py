"""Integration tests for GET /parties/:canonical_id (M4 Group A).

Endpoint returns party details, open invoices, and summary KPIs.
POST /parties/:canonical_id/follow-ups returns 501 (tested in test_follow_ups_stub.py).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.entity import Entity
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


def _make_canonical_with_invoices(
    db_session: Session,
    entity_code: str = "IND",
    canonical_name: str = "PartyDrilldown",
    num_invoices: int = 2,
    amount_each: float = 5000.0,
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)

    canonical = PartyCanonical(
        entity_id=entity_id,
        name=canonical_name,
        created_by=admin,
    )
    db_session.add(canonical)
    db_session.flush()

    snap = Snapshot(
        entity_id=entity_id,
        as_of_date=date(2026, 3, 31),
        status="PUBLISHED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
    )
    db_session.add(snap)
    db_session.flush()

    for i in range(num_invoices):
        inv = Invoice(
            invoice_ref=f"{canonical_name}-INV-{i}",
            invoice_date=date(2026, 1, 15),
            amount=amount_each,
            currency="INR" if entity_code == "IND" else "AED",
            due_date=date(2026, 2, 14),
            status="OPEN",
            entity_id=entity_id,
            canonical_id=canonical.id,
            first_seen_snapshot_id=snap.id,
            credit_days_applied=30,
            credit_days_source="MANUAL",
            raw_row_json={},
        )
        db_session.add(inv)
        db_session.flush()

        inv_snap = InvoiceSnapshot(
            snapshot_id=snap.id,
            invoice_id=inv.id,
            as_of_date=date(2026, 3, 31),
            outstanding_amount=Decimal(str(amount_each)),
            overdue_days=45,
            bucket="31_60",
        )
        db_session.add(inv_snap)

    db_session.flush()
    return canonical.id


# ---------------------------------------------------------------------------
# GET /parties/:canonical_id
# ---------------------------------------------------------------------------


def test_get_party_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    cid = _make_canonical_with_invoices(db_session, canonical_name="DrillPartyA")

    resp = client.get(f"/parties/{cid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["canonical_id"] == str(cid)
    assert body["canonical_name"] == "DrillPartyA"


def test_get_party_404_unknown(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.get(f"/parties/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_party_includes_invoices(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    cid = _make_canonical_with_invoices(
        db_session, canonical_name="DrillPartyB", num_invoices=3
    )

    resp = client.get(f"/parties/{cid}")
    assert resp.status_code == 200
    body = resp.json()
    assert "invoices" in body
    assert len(body["invoices"]) == 3


def test_get_party_invoice_fields(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    cid = _make_canonical_with_invoices(
        db_session, canonical_name="DrillPartyC", num_invoices=1
    )

    resp = client.get(f"/parties/{cid}")
    body = resp.json()
    inv = body["invoices"][0]
    for field in ("invoice_id", "invoice_ref", "amount", "status", "outstanding_amount"):
        assert field in inv, f"Missing field: {field}"


def test_get_party_analyst_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    cid = _make_canonical_with_invoices(db_session, canonical_name="DrillPartyD")
    resp = client.get(f"/parties/{cid}")
    assert resp.status_code == 200


def test_get_party_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    cid = _make_canonical_with_invoices(db_session, canonical_name="DrillPartyE")
    resp = client.get(f"/parties/{cid}")
    assert resp.status_code == 200


def test_get_party_analyst_out_of_scope_403(
    client: TestClient, db_session: Session
) -> None:
    """Analyst scoped to IND cannot see UAE canonical party."""
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="IND")
    uae_cid = _make_canonical_with_invoices(
        db_session, entity_code="UAE", canonical_name="DrillPartyUAE"
    )
    resp = client.get(f"/parties/{uae_cid}")
    assert resp.status_code == 403


def test_get_party_shows_entity_code(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    cid = _make_canonical_with_invoices(
        db_session, entity_code="IND", canonical_name="DrillPartyF"
    )
    resp = client.get(f"/parties/{cid}")
    body = resp.json()
    assert body["entity_code"] == "IND"
