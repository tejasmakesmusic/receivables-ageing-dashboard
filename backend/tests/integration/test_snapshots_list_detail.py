"""Integration tests for GET /snapshots and GET /snapshots/:id (M4 Group A).

Tests paginated snapshot list and snapshot detail endpoint.
RBAC: ANALYST, ADMIN, CFO can read. PENDING cannot.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.entity import Entity
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


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return cast(uuid.UUID, u.id)


def _entity_id(db_session: Session, code: str = "IND") -> uuid.UUID:
    e = db_session.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return cast(uuid.UUID, e.id)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _make_snapshot(
    db_session: Session,
    entity_code: str = "IND",
    status: str = "PUBLISHED",
    as_of_date: date = date(2026, 3, 31),
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    snap = Snapshot(
        entity_id=entity_id,
        as_of_date=as_of_date,
        status=status,
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
    )
    db_session.add(snap)
    db_session.flush()
    return cast(uuid.UUID, snap.id)


# ---------------------------------------------------------------------------
# GET /snapshots (list)
# ---------------------------------------------------------------------------


def test_list_snapshots_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_snapshot(db_session)

    resp = client.get("/snapshots")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert isinstance(body["items"], list)


def test_list_snapshots_200_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/snapshots")
    assert resp.status_code == 200


def test_list_snapshots_200_cfo(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = client.get("/snapshots")
    assert resp.status_code == 200


def test_list_snapshots_filter_by_entity(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_snapshot(db_session, entity_code="IND", as_of_date=date(2026, 1, 31))
    _make_snapshot(db_session, entity_code="UAE", as_of_date=date(2026, 1, 31))

    resp = client.get("/snapshots?entity_code=IND")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["entity_code"] == "IND" for i in items)


def test_list_snapshots_filter_by_status(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_snapshot(db_session, status="PUBLISHED", as_of_date=date(2026, 2, 28))
    _make_snapshot(db_session, status="STAGED", as_of_date=date(2026, 3, 15))

    resp = client.get("/snapshots?status=PUBLISHED")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["status"] == "PUBLISHED" for i in items)


def test_list_snapshots_analyst_entity_scope(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND can only see IND snapshots."""
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="IND")
    _make_snapshot(db_session, entity_code="IND", as_of_date=date(2026, 3, 31))
    _make_snapshot(db_session, entity_code="UAE", as_of_date=date(2026, 3, 31))

    resp = client.get("/snapshots")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["entity_code"] == "IND" for i in items)


def test_list_snapshots_pagination(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    for m in range(1, 4):
        _make_snapshot(db_session, as_of_date=date(2026, m, 28))

    resp = client.get("/snapshots?page=1&page_size=2")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) <= 2


def test_list_snapshots_row_fields(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _make_snapshot(db_session, as_of_date=date(2026, 4, 30))

    resp = client.get("/snapshots")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = items[0]
    for field in ("id", "entity_code", "as_of_date", "status", "source_hint"):
        assert field in row, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# GET /snapshots/:id (detail)
# ---------------------------------------------------------------------------


def test_get_snapshot_detail_200(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snap_id = _make_snapshot(db_session, as_of_date=date(2026, 4, 30))

    resp = client.get(f"/snapshots/{snap_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(snap_id)
    assert body["status"] in ("PUBLISHED", "STAGED", "DISCARDED")


def test_get_snapshot_detail_404_unknown(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.get(f"/snapshots/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_get_snapshot_detail_analyst_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    snap_id = _make_snapshot(db_session)
    resp = client.get(f"/snapshots/{snap_id}")
    assert resp.status_code == 200


def test_get_snapshot_detail_cfo_can_read(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    snap_id = _make_snapshot(db_session)
    resp = client.get(f"/snapshots/{snap_id}")
    assert resp.status_code == 200


def test_get_snapshot_detail_analyst_scoped_403(client: TestClient, db_session: Session) -> None:
    """ANALYST scoped to IND cannot see UAE snapshot."""
    _login_as_analyst(client, db_session, "analyst@emb.global", entity_code="IND")
    uae_snap_id = _make_snapshot(db_session, entity_code="UAE")
    resp = client.get(f"/snapshots/{uae_snap_id}")
    assert resp.status_code == 403
