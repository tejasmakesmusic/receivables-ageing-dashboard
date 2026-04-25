"""Integration tests for GET /admin/email-outbox and POST /admin/email-outbox/:id/mark-sent.

ADMIN only. mark-sent: 409 if already SENT.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.email_outbox import EmailOutbox
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


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return cast(uuid.UUID, u.id)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _seed_outbox(
    db_session: Session,
    status: str = "QUEUED",
    rule_type: str = "PUBLISH_NOTIF",
) -> uuid.UUID:
    entry = EmailOutbox(
        subject="Test subject",
        body_html="<p>Test</p>",
        status=status,
        rule_type=rule_type,
    )
    db_session.add(entry)
    db_session.flush()
    return cast(uuid.UUID, entry.id)


# ---------------------------------------------------------------------------
# GET /admin/email-outbox
# ---------------------------------------------------------------------------


def test_get_email_outbox_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_outbox(db_session, status="QUEUED")

    resp = client.get("/admin/email-outbox")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body


def test_get_email_outbox_403_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/admin/email-outbox")
    assert resp.status_code == 403


def test_get_email_outbox_filter_by_status(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_outbox(db_session, status="QUEUED")
    _seed_outbox(db_session, status="SENT")  # SENT is a valid status

    resp = client.get("/admin/email-outbox?status=QUEUED")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["status"] == "QUEUED" for i in items)


def test_get_email_outbox_filter_by_rule_type(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_outbox(db_session, rule_type="PUBLISH_NOTIF")
    _seed_outbox(db_session, rule_type="DAILY_DIGEST")

    resp = client.get("/admin/email-outbox?rule_type=PUBLISH_NOTIF")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["rule_type"] == "PUBLISH_NOTIF" for i in items)


def test_get_email_outbox_row_fields(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_outbox(db_session)

    resp = client.get("/admin/email-outbox")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = items[0]
    for field in ("id", "subject", "status", "rule_type", "enqueued_at"):
        assert field in row, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# POST /admin/email-outbox/:id/mark-sent
# ---------------------------------------------------------------------------


def test_mark_sent_200_queued_email(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    eid = _seed_outbox(db_session, status="QUEUED")

    resp = client.post(
        f"/admin/email-outbox/{eid}/mark-sent",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["status"] == "SENT"
    assert body["id"] == str(eid)


def test_mark_sent_409_already_sent(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    eid = _seed_outbox(db_session, status="SENT")

    resp = client.post(
        f"/admin/email-outbox/{eid}/mark-sent",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "ALREADY_SENT"


def test_mark_sent_404_unknown(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.post(
        f"/admin/email-outbox/{uuid.uuid4()}/mark-sent",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 404


def test_mark_sent_403_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    eid = _seed_outbox(db_session, status="QUEUED")
    resp = client.post(
        f"/admin/email-outbox/{eid}/mark-sent",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_mark_sent_writes_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    from app.db.models.audit_log import AuditLog

    eid = _seed_outbox(db_session, status="QUEUED")
    before = db_session.query(AuditLog).filter(AuditLog.action == "email_outbox.mark_sent").count()

    client.post(f"/admin/email-outbox/{eid}/mark-sent", json={}, headers=_headers(client))
    after = db_session.query(AuditLog).filter(AuditLog.action == "email_outbox.mark_sent").count()
    assert after == before + 1
