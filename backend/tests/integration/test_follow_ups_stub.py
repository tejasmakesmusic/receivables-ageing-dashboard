"""Integration tests for follow-up stub endpoints (M5 Group D).

All follow-up endpoints return 501 with structured payload:
  {code: "NOT_IMPLEMENTED", detail: "...", endpoint: "..."}

Endpoints:
  POST /invoices/:id/follow-ups
  POST /parties/:canonical_id/follow-ups
  GET  /follow-ups
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.entity import Entity
from app.db.models.invoice import Invoice
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
    return client.cookies.get("csrf_token", "")


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient, db_session: Session, email: str = "analyst@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
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


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return u.id


def _entity_id(db_session: Session, code: str = "IND") -> uuid.UUID:
    e = db_session.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return e.id


def _make_invoice_and_canonical(db_session: Session) -> tuple[uuid.UUID, uuid.UUID]:
    """Create minimal canonical party + invoice. Returns (invoice_id, canonical_id)."""
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session)
    canonical = PartyCanonical(entity_id=entity_id, name="FollowUpParty", created_by=admin)
    db_session.add(canonical)
    db_session.flush()
    invoice = Invoice(
        invoice_ref="FU-INV-001",
        invoice_date=__import__("datetime").date(2026, 1, 15),
        amount=1000.0,
        currency="INR",
        due_date=__import__("datetime").date(2026, 2, 14),
        status="OPEN",
        entity_id=entity_id,
        canonical_id=canonical.id,
    )
    db_session.add(invoice)
    db_session.flush()
    return invoice.id, canonical.id


# ---------------------------------------------------------------------------
# POST /invoices/:id/follow-ups → 501
# ---------------------------------------------------------------------------


def test_invoice_follow_up_stub_501_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id, _ = _make_invoice_and_canonical(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={"channel": "EMAIL", "notes": "Test"},
        headers=_headers(client),
    )
    assert resp.status_code == 501
    body = resp.json()
    assert body["code"] == "NOT_IMPLEMENTED"
    assert (
        "follow-ups" in body["endpoint"].lower()
        or "follow_up" in body["endpoint"].lower()
        or str(invoice_id) in body["endpoint"]
    )


def test_invoice_follow_up_stub_501_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    invoice_id, _ = _make_invoice_and_canonical(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 501


def test_invoice_follow_up_stub_501_cfo(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    invoice_id, _ = _make_invoice_and_canonical(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 501


def test_invoice_follow_up_stub_has_structured_payload(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    invoice_id, _ = _make_invoice_and_canonical(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 501
    body = resp.json()
    assert "code" in body
    assert "detail" in body
    assert "endpoint" in body


# ---------------------------------------------------------------------------
# POST /parties/:canonical_id/follow-ups → 501
# ---------------------------------------------------------------------------


def test_party_follow_up_stub_501_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _, canonical_id = _make_invoice_and_canonical(db_session)

    resp = client.post(
        f"/parties/{canonical_id}/follow-ups",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 501
    body = resp.json()
    assert body["code"] == "NOT_IMPLEMENTED"


def test_party_follow_up_stub_has_structured_payload(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    _, canonical_id = _make_invoice_and_canonical(db_session)

    resp = client.post(
        f"/parties/{canonical_id}/follow-ups",
        json={},
        headers=_headers(client),
    )
    body = resp.json()
    assert "code" in body
    assert "detail" in body
    assert "endpoint" in body


# ---------------------------------------------------------------------------
# GET /follow-ups → 501
# ---------------------------------------------------------------------------


def test_get_follow_ups_stub_501_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.get("/follow-ups")
    assert resp.status_code == 501
    body = resp.json()
    assert body["code"] == "NOT_IMPLEMENTED"


def test_get_follow_ups_stub_501_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/follow-ups")
    assert resp.status_code == 501


def test_get_follow_ups_stub_has_structured_payload(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    resp = client.get("/follow-ups")
    body = resp.json()
    assert "code" in body
    assert "detail" in body
    assert "endpoint" in body
