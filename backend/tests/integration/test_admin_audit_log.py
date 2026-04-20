"""Integration tests for GET /admin/audit-log (M6 Group F).

ADMIN only. Supports filters: actor_id, action, entity_type, ts_from, ts_to. Paginated.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
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
    client: TestClient, db_session: Session, email: str = "analyst@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
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
    return cast(uuid.UUID, u.id)


# ---------------------------------------------------------------------------
# Helpers — seed audit log entries directly
# ---------------------------------------------------------------------------


def _seed_log(
    db_session: Session,
    action: str = "test.action",
    entity_type: str = "test_table",
    actor_id: uuid.UUID | None = None,
) -> AuditLog:
    if actor_id is None:
        actor_id = _admin_id(db_session)
    entry = AuditLog(
        action=action,
        entity_type=entity_type,
        entity_id=uuid.uuid4(),
        actor_user_id=actor_id,
        before=None,
        after={"test": "value"},
    )
    db_session.add(entry)
    db_session.flush()
    return entry


# ---------------------------------------------------------------------------
# GET /admin/audit-log
# ---------------------------------------------------------------------------


def test_get_audit_log_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_log(db_session)

    resp = client.get("/admin/audit-log")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert isinstance(body["items"], list)


def test_get_audit_log_403_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/admin/audit-log")
    assert resp.status_code == 403


def test_get_audit_log_403_cfo(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = client.get("/admin/audit-log")
    assert resp.status_code == 403


def test_get_audit_log_filter_by_action(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_log(db_session, action="snapshot.publish")
    _seed_log(db_session, action="reconciliation.upsert")

    resp = client.get("/admin/audit-log?action=snapshot.publish")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["action"] == "snapshot.publish" for i in items)


def test_get_audit_log_filter_by_entity_type(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_log(db_session, entity_type="snapshots")
    _seed_log(db_session, entity_type="invoices")

    resp = client.get("/admin/audit-log?entity_type=snapshots")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["entity_type"] == "snapshots" for i in items)


def test_get_audit_log_filter_by_actor_id(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    admin = _admin_id(db_session)
    _seed_log(db_session, action="actor.test", actor_id=admin)

    resp = client.get(f"/admin/audit-log?actor_id={admin}")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["actor_user_id"] == str(admin) for i in items)


def test_get_audit_log_pagination(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    for i in range(5):
        _seed_log(db_session, action=f"page.test.{i}")

    resp = client.get("/admin/audit-log?page=1&page_size=3")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) <= 3
    assert body["page"] == 1


def test_get_audit_log_ts_from_filter(client: TestClient, db_session: Session) -> None:
    """ts_from filter must only return entries at or after the timestamp."""
    _login_as_admin(client)
    _seed_log(db_session, action="ts.filter.test")

    # ts_from set to far future → should return no items matching this action
    resp = client.get("/admin/audit-log?action=ts.filter.test&ts_from=2030-01-01T00:00:00Z")
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_get_audit_log_rows_contain_required_fields(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    _seed_log(db_session, action="field.check.test")

    resp = client.get("/admin/audit-log?action=field.check.test")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = items[0]
    for field in ("id", "action", "entity_type", "entity_id", "actor_user_id", "created_at"):
        assert field in row, f"Missing field: {field}"
