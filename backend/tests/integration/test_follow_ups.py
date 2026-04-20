"""Integration tests for follow-ups CRUD (M5 full, S6 backend).

Endpoints:
  GET    /follow-ups
  GET    /follow-ups/{id}
  POST   /follow-ups
  PATCH  /follow-ups/{id}
  DELETE /follow-ups/{id}
  POST   /parties/{canonical_id}/follow-ups  (convenience wrapper)
  POST   /invoices/{invoice_id}/follow-ups   (convenience wrapper)

RBAC:
  Read:   ANALYST (entity-scoped), ADMIN, CFO.
  Write:  ANALYST (entity-scoped), ADMIN. CFO/PENDING → 403.
  Delete: ADMIN only.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
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


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient,
    db_session: Session,
    email: str = "analyst@emb.global",
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


def _login_as_cfo(
    client: TestClient, db_session: Session, email: str = "cfo@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _login_as_pending(
    client: TestClient, db_session: Session, email: str = "pending@emb.global"
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


def _make_snapshot(db_session: Session, entity_code: str = "IND") -> uuid.UUID:
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
    return cast(uuid.UUID, snap.id)


def _make_canonical(
    db_session: Session,
    entity_code: str = "IND",
    name: str | None = None,
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    canonical = PartyCanonical(
        entity_id=entity_id,
        name=name or f"TestParty-{uuid.uuid4().hex[:8]}",
        created_by=admin,
    )
    db_session.add(canonical)
    db_session.flush()
    return cast(uuid.UUID, canonical.id)


def _make_invoice(
    db_session: Session,
    entity_code: str = "IND",
    ref: str | None = None,
    canonical_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Return (invoice_id, canonical_id)."""
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    snap_id = _make_snapshot(db_session, entity_code)

    if canonical_id is None:
        canonical = PartyCanonical(
            entity_id=entity_id,
            name=f"InvParty-{uuid.uuid4().hex[:8]}",
            created_by=admin,
        )
        db_session.add(canonical)
        db_session.flush()
        canonical_id = cast(uuid.UUID, canonical.id)

    inv = Invoice(
        invoice_ref=ref or f"INV-FU-{uuid.uuid4().hex[:8]}",
        invoice_date=date(2026, 1, 15),
        amount=10_000.0,
        currency="INR",
        due_date=date(2026, 2, 14),
        status="OPEN",
        entity_id=entity_id,
        canonical_id=canonical_id,
        first_seen_snapshot_id=snap_id,
        credit_days_applied=30,
        credit_days_source="MANUAL",
        raw_row_json={},
    )
    db_session.add(inv)
    db_session.flush()
    return cast(uuid.UUID, inv.id), canonical_id


def _post_follow_up(
    client: TestClient,
    *,
    invoice_id: uuid.UUID | None = None,
    canonical_id: uuid.UUID | None = None,
    fu_date: str = "2026-04-01",
    channel: str = "EMAIL",
    notes: str | None = None,
) -> Any:
    """POST /follow-ups with exactly one of invoice_id/canonical_id."""
    body: dict[str, Any] = {
        "date": fu_date,
        "channel": channel,
    }
    if invoice_id is not None:
        body["invoice_id"] = str(invoice_id)
    if canonical_id is not None:
        body["canonical_id"] = str(canonical_id)
    if notes is not None:
        body["notes"] = notes
    return client.post("/follow-ups", json=body, headers=_headers(client))


# ---------------------------------------------------------------------------
# POST /follow-ups — create
# ---------------------------------------------------------------------------


def test_create_follow_up_via_invoice_201(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id, _ = _make_invoice(db_session)

    resp = _post_follow_up(client, invoice_id=invoice_id, channel="CALL", notes="Called client")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["invoice_id"] == str(invoice_id)
    assert body["channel"] == "CALL"
    assert body["notes"] == "Called client"
    assert "id" in body
    assert body["logged_by_email"] == "tejaswa.sharma@emb.global"


def test_create_follow_up_via_canonical_201(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)

    resp = _post_follow_up(client, canonical_id=canonical_id, channel="WHATSAPP")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["canonical_id"] == str(canonical_id)
    assert body["invoice_id"] is None


def test_create_follow_up_both_targets_422(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id, canonical_id = _make_invoice(db_session)

    resp = client.post(
        "/follow-ups",
        json={
            "date": "2026-04-01",
            "channel": "EMAIL",
            "invoice_id": str(invoice_id),
            "canonical_id": str(canonical_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 422


def test_create_follow_up_neither_target_422(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)

    resp = client.post(
        "/follow-ups",
        json={"date": "2026-04-01", "channel": "EMAIL"},
        headers=_headers(client),
    )
    assert resp.status_code == 422


def test_create_follow_up_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session)
    canonical_id = _make_canonical(db_session)

    resp = _post_follow_up(client, canonical_id=canonical_id)
    assert resp.status_code == 403


def test_create_follow_up_pending_403(client: TestClient, db_session: Session) -> None:
    _login_as_pending(client, db_session)
    canonical_id = _make_canonical(db_session)

    resp = _post_follow_up(client, canonical_id=canonical_id)
    assert resp.status_code == 403


def test_create_follow_up_analyst_scoped_403(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND cannot create follow-up on UAE party."""
    _login_as_analyst(client, db_session, entity_code="IND")
    canonical_id = _make_canonical(db_session, entity_code="UAE")

    resp = _post_follow_up(client, canonical_id=canonical_id)
    assert resp.status_code == 403


def test_create_follow_up_analyst_in_scope_201(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, entity_code="IND")
    canonical_id = _make_canonical(db_session, entity_code="IND")

    resp = _post_follow_up(client, canonical_id=canonical_id, channel="MEETING")
    assert resp.status_code == 201, resp.json()


def test_create_follow_up_404_unknown_invoice(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = _post_follow_up(client, invoice_id=uuid.uuid4())
    assert resp.status_code == 404


def test_create_follow_up_404_unknown_canonical(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = _post_follow_up(client, canonical_id=uuid.uuid4())
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Audit log written on create
# ---------------------------------------------------------------------------


def test_create_follow_up_writes_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)

    resp = _post_follow_up(client, canonical_id=canonical_id, channel="EMAIL")
    assert resp.status_code == 201, resp.json()
    fu_id = uuid.UUID(resp.json()["id"])

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "FOLLOW_UP_CREATED",
            AuditLog.entity_id == fu_id,
        )
    )
    assert audit is not None
    assert audit.before is None
    assert audit.after is not None
    assert audit.after["channel"] == "EMAIL"


# ---------------------------------------------------------------------------
# GET /follow-ups/{id}
# ---------------------------------------------------------------------------


def test_get_follow_up_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id, channel="CALL")
    fu_id = create_resp.json()["id"]

    resp = client.get(f"/follow-ups/{fu_id}")
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["id"] == fu_id
    assert body["channel"] == "CALL"


def test_get_follow_up_404(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.get(f"/follow-ups/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_follow_up_analyst_out_of_scope_403(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND cannot read UAE follow-up."""
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session, entity_code="UAE")
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    _login_as_analyst(client, db_session, entity_code="IND")
    resp = client.get(f"/follow-ups/{fu_id}")
    assert resp.status_code == 403


def test_get_follow_up_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    _login_as_cfo(client, db_session)
    resp = client.get(f"/follow-ups/{fu_id}")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /follow-ups — list & filters
# ---------------------------------------------------------------------------


def test_list_follow_ups_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    _post_follow_up(client, canonical_id=canonical_id)

    resp = client.get("/follow-ups")
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert isinstance(body["items"], list)


def test_list_follow_ups_filter_by_channel(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    _post_follow_up(client, canonical_id=canonical_id, channel="MEETING")
    _post_follow_up(client, canonical_id=canonical_id, channel="EMAIL")

    resp = client.get("/follow-ups?channel=MEETING")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["channel"] == "MEETING" for i in items)


def test_list_follow_ups_filter_by_canonical_id(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_a = _make_canonical(db_session)
    canonical_b = _make_canonical(db_session)
    _post_follow_up(client, canonical_id=canonical_a, channel="CALL")
    _post_follow_up(client, canonical_id=canonical_b, channel="EMAIL")

    resp = client.get(f"/follow-ups?canonical_id={canonical_a}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["canonical_id"] == str(canonical_a) for i in items)


def test_list_follow_ups_filter_by_invoice_id(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id, _ = _make_invoice(db_session)
    _post_follow_up(client, invoice_id=invoice_id)

    resp = client.get(f"/follow-ups?invoice_id={invoice_id}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert any(i["invoice_id"] == str(invoice_id) for i in items)


def test_list_follow_ups_filter_by_entity(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_ind = _make_canonical(db_session, entity_code="IND")
    canonical_uae = _make_canonical(db_session, entity_code="UAE")
    _post_follow_up(client, canonical_id=canonical_ind, channel="CALL")
    _post_follow_up(client, canonical_id=canonical_uae, channel="EMAIL")

    resp = client.get("/follow-ups?entity=IND")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["canonical_id"] == str(canonical_ind) for i in items if i["invoice_id"] is None)


def test_list_follow_ups_date_range_filter(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    _post_follow_up(client, canonical_id=canonical_id, fu_date="2026-03-01")
    _post_follow_up(client, canonical_id=canonical_id, fu_date="2026-04-01")
    _post_follow_up(client, canonical_id=canonical_id, fu_date="2026-05-01")

    resp = client.get(
        f"/follow-ups?canonical_id={canonical_id}&date_from=2026-03-15&date_to=2026-04-15"
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    dates = [i["date"] for i in items]
    assert all("2026-03-15" <= d <= "2026-04-15" for d in dates)


def test_list_follow_ups_pagination(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    for i in range(5):
        _post_follow_up(
            client, canonical_id=canonical_id, fu_date=f"2026-0{i + 1}-01"
        )

    resp = client.get(f"/follow-ups?canonical_id={canonical_id}&page=1&page_size=3")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 3
    assert body["page"] == 1
    assert body["page_size"] == 3


def test_list_follow_ups_analyst_entity_scoped(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND only sees IND follow-ups."""
    _login_as_admin(client)
    canonical_ind = _make_canonical(db_session, entity_code="IND")
    canonical_uae = _make_canonical(db_session, entity_code="UAE")
    _post_follow_up(client, canonical_id=canonical_ind)
    _post_follow_up(client, canonical_id=canonical_uae)

    _login_as_analyst(client, db_session, entity_code="IND")
    resp = client.get("/follow-ups")
    assert resp.status_code == 200
    items = resp.json()["items"]
    canonical_ids = {i["canonical_id"] for i in items}
    assert str(canonical_ind) in canonical_ids
    assert str(canonical_uae) not in canonical_ids


def test_list_follow_ups_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session)
    resp = client.get("/follow-ups")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# PATCH /follow-ups/{id}
# ---------------------------------------------------------------------------


def test_patch_follow_up_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id, channel="EMAIL")
    fu_id = create_resp.json()["id"]

    resp = client.patch(
        f"/follow-ups/{fu_id}",
        json={"channel": "CALL", "notes": "Switched to call"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["channel"] == "CALL"
    assert body["notes"] == "Switched to call"


def test_patch_follow_up_partial_update(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(
        client, canonical_id=canonical_id, channel="EMAIL", notes="Original note"
    )
    fu_id = create_resp.json()["id"]

    # Only update notes; channel should remain EMAIL
    resp = client.patch(
        f"/follow-ups/{fu_id}",
        json={"notes": "Updated note"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["channel"] == "EMAIL"
    assert body["notes"] == "Updated note"


def test_patch_follow_up_404(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.patch(
        f"/follow-ups/{uuid.uuid4()}",
        json={"channel": "CALL"},
        headers=_headers(client),
    )
    assert resp.status_code == 404


def test_patch_follow_up_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    _login_as_cfo(client, db_session)
    resp = client.patch(
        f"/follow-ups/{fu_id}",
        json={"channel": "CALL"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_patch_follow_up_analyst_out_of_scope_403(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND cannot patch UAE follow-up."""
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session, entity_code="UAE")
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    _login_as_analyst(client, db_session, entity_code="IND")
    resp = client.patch(
        f"/follow-ups/{fu_id}",
        json={"channel": "CALL"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_patch_follow_up_writes_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id, channel="EMAIL")
    fu_id = uuid.UUID(create_resp.json()["id"])

    client.patch(
        f"/follow-ups/{fu_id}",
        json={"channel": "WHATSAPP"},
        headers=_headers(client),
    )

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "FOLLOW_UP_UPDATED",
            AuditLog.entity_id == fu_id,
        )
    )
    assert audit is not None
    assert audit.before is not None
    assert audit.before["channel"] == "EMAIL"
    assert audit.after is not None
    assert audit.after["channel"] == "WHATSAPP"


# ---------------------------------------------------------------------------
# DELETE /follow-ups/{id}
# ---------------------------------------------------------------------------


def test_delete_follow_up_204(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    resp = client.delete(f"/follow-ups/{fu_id}", headers=_headers(client))
    assert resp.status_code == 204

    # Confirm gone
    get_resp = client.get(f"/follow-ups/{fu_id}")
    assert get_resp.status_code == 404


def test_delete_follow_up_404(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.delete(f"/follow-ups/{uuid.uuid4()}", headers=_headers(client))
    assert resp.status_code == 404


def test_delete_follow_up_analyst_403(client: TestClient, db_session: Session) -> None:
    """Only ADMIN can delete; ANALYST gets 403."""
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    _login_as_analyst(client, db_session, entity_code="IND")
    resp = client.delete(f"/follow-ups/{fu_id}", headers=_headers(client))
    assert resp.status_code == 403


def test_delete_follow_up_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id)
    fu_id = create_resp.json()["id"]

    _login_as_cfo(client, db_session)
    resp = client.delete(f"/follow-ups/{fu_id}", headers=_headers(client))
    assert resp.status_code == 403


def test_delete_follow_up_writes_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)
    create_resp = _post_follow_up(client, canonical_id=canonical_id, channel="EMAIL")
    fu_id = uuid.UUID(create_resp.json()["id"])

    client.delete(f"/follow-ups/{fu_id}", headers=_headers(client))

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "FOLLOW_UP_DELETED",
            AuditLog.entity_id == fu_id,
        )
    )
    assert audit is not None
    assert audit.before is not None
    assert audit.after is None


# ---------------------------------------------------------------------------
# POST /parties/{canonical_id}/follow-ups  (convenience wrapper)
# ---------------------------------------------------------------------------


def test_create_follow_up_via_party_route_201(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _make_canonical(db_session)

    resp = client.post(
        f"/parties/{canonical_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "MEETING",
            "canonical_id": str(canonical_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["canonical_id"] == str(canonical_id)
    assert body["invoice_id"] is None
    assert body["channel"] == "MEETING"


def test_create_follow_up_via_party_route_unknown_canonical_404(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    fake_id = uuid.uuid4()

    resp = client.post(
        f"/parties/{fake_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "EMAIL",
            "canonical_id": str(fake_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 404


def test_create_follow_up_via_party_route_cfo_403(
    client: TestClient, db_session: Session
) -> None:
    _login_as_cfo(client, db_session)
    canonical_id = _make_canonical(db_session)

    resp = client.post(
        f"/parties/{canonical_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "EMAIL",
            "canonical_id": str(canonical_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /invoices/{invoice_id}/follow-ups  (convenience wrapper)
# ---------------------------------------------------------------------------


def test_create_follow_up_via_invoice_route_201(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    invoice_id, canonical_id = _make_invoice(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "CALL",
            "invoice_id": str(invoice_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["invoice_id"] == str(invoice_id)
    assert body["canonical_id"] == str(canonical_id)
    assert body["channel"] == "CALL"


def test_create_follow_up_via_invoice_route_unknown_invoice_404(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    fake_id = uuid.uuid4()

    resp = client.post(
        f"/invoices/{fake_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "EMAIL",
            "invoice_id": str(fake_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 404


def test_create_follow_up_via_invoice_route_analyst_scoped_403(
    client: TestClient, db_session: Session
) -> None:
    """ANALYST scoped to IND cannot create follow-up on UAE invoice."""
    _login_as_admin(client)
    invoice_id, _ = _make_invoice(db_session, entity_code="UAE")

    _login_as_analyst(client, db_session, entity_code="IND")
    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "EMAIL",
            "invoice_id": str(invoice_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_create_follow_up_via_invoice_route_cfo_403(
    client: TestClient, db_session: Session
) -> None:
    _login_as_cfo(client, db_session)
    invoice_id, _ = _make_invoice(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "EMAIL",
            "invoice_id": str(invoice_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_create_follow_up_via_invoice_route_writes_audit_log(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    invoice_id, _ = _make_invoice(db_session)

    resp = client.post(
        f"/invoices/{invoice_id}/follow-ups",
        json={
            "date": "2026-04-10",
            "channel": "WHATSAPP",
            "invoice_id": str(invoice_id),
        },
        headers=_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    fu_id = uuid.UUID(resp.json()["id"])

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "FOLLOW_UP_CREATED",
            AuditLog.entity_id == fu_id,
        )
    )
    assert audit is not None
