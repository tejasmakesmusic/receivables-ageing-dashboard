"""Integration tests for email_rules table + admin CRUD (Task A.3).

Coverage:
  1. GET /admin/email-rules — all non-PENDING roles OK; PENDING 403
  2. PATCH /admin/email-rules/{id} — ADMIN happy path
  3. PATCH — ANALYST 403; CFO 403; PENDING 403
  4. Recipients validation — invalid email → 422
  5. rule_type is NOT accepted in PATCH body (ignored — extra fields dropped)
  6. Audit log row written with before/after on PATCH
  7. Seeded rows: 3 rows present after migrations
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.email_rule import EmailRule
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ADMIN_EMAIL = "tejaswa.sharma@emb.global"


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _login_as_admin(client: TestClient) -> None:
    _login(client, ADMIN_EMAIL)


def _make_user(db: Session, email: str, role: Role) -> User:
    """Create (or update existing) a user with the given role."""
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, name=f"{role.value}-user", role=role, is_active=True)
        db.add(user)
        db.flush()
    else:
        user.role = role
        user.is_active = True
        db.flush()
    return user


def _get_rule(db: Session, rule_type: str) -> EmailRule:
    """Fetch a seeded email rule row; fail clearly if missing."""
    rule = db.scalar(select(EmailRule).where(EmailRule.rule_type == rule_type))
    assert rule is not None, f"Email rule '{rule_type}' not found — migration may not have run."
    return rule


# ---------------------------------------------------------------------------
# 1. GET list — all non-PENDING roles OK; PENDING 403
# ---------------------------------------------------------------------------


def test_list_email_rules_admin(client: TestClient) -> None:
    """ADMIN can list email rules — 3 seeded rows present."""
    _login_as_admin(client)
    resp = client.get("/admin/email-rules")
    assert resp.status_code == 200, resp.json()
    data = resp.json()
    assert data["total"] >= 3
    rule_types = {r["rule_type"] for r in data["items"]}
    assert {"DAILY_DIGEST", "WEEKLY_DEFAULT_CP_NUDGE", "PUBLISH_NOTIF"} <= rule_types


def test_list_email_rules_analyst(client: TestClient, db_session: Session) -> None:
    """ANALYST can read email rules."""
    tag = uuid.uuid4().hex[:8]
    _make_user(db_session, f"analyst+{tag}@emb.global", Role.ANALYST)
    db_session.commit()
    _login(client, f"analyst+{tag}@emb.global")
    resp = client.get("/admin/email-rules")
    assert resp.status_code == 200, resp.json()


def test_list_email_rules_cfo(client: TestClient, db_session: Session) -> None:
    """CFO can read email rules."""
    tag = uuid.uuid4().hex[:8]
    _make_user(db_session, f"cfo+{tag}@emb.global", Role.CFO)
    db_session.commit()
    _login(client, f"cfo+{tag}@emb.global")
    resp = client.get("/admin/email-rules")
    assert resp.status_code == 200, resp.json()


def test_list_email_rules_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING role cannot read email rules."""
    tag = uuid.uuid4().hex[:8]
    _make_user(db_session, f"pending+{tag}@emb.global", Role.PENDING)
    db_session.commit()
    _login(client, f"pending+{tag}@emb.global")
    resp = client.get("/admin/email-rules")
    assert resp.status_code == 403, resp.json()


# ---------------------------------------------------------------------------
# 2. PATCH — ADMIN happy path
# ---------------------------------------------------------------------------


def test_patch_email_rule_admin(client: TestClient, db_session: Session) -> None:
    """ADMIN can patch recipients, cron_schedule, is_active, entity_filter, notes."""
    _login_as_admin(client)
    rule = _get_rule(db_session, "DAILY_DIGEST")
    rule_id = str(rule.id)

    payload = {
        "recipients_json": ["finance@emb.global", "cfo@emb.global"],
        "cron_schedule": "0 8 * * *",
        "is_active": True,
        "entity_filter": "IND",
        "notes": "Test note",
    }
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule_id}",
        json=payload,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 200, resp.json()
    data = resp.json()
    assert data["recipients_json"] == ["finance@emb.global", "cfo@emb.global"]
    assert data["cron_schedule"] == "0 8 * * *"
    assert data["is_active"] is True
    assert data["entity_filter"] == "IND"
    assert data["notes"] == "Test note"
    assert data["rule_type"] == "DAILY_DIGEST"  # immutable — not changed


def test_patch_email_rule_not_found(client: TestClient) -> None:
    """Non-existent rule_id → 404."""
    _login_as_admin(client)
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{uuid.uuid4()}",
        json={"is_active": False},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 404, resp.json()


# ---------------------------------------------------------------------------
# 3. PATCH — non-ADMIN roles → 403
# ---------------------------------------------------------------------------


def test_patch_email_rule_analyst_403(client: TestClient, db_session: Session) -> None:
    """ANALYST cannot patch email rules."""
    tag = uuid.uuid4().hex[:8]
    _make_user(db_session, f"analyst+{tag}@emb.global", Role.ANALYST)
    db_session.commit()
    _login(client, f"analyst+{tag}@emb.global")
    rule = _get_rule(db_session, "DAILY_DIGEST")
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule.id}",
        json={"is_active": True},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 403, resp.json()


def test_patch_email_rule_cfo_403(client: TestClient, db_session: Session) -> None:
    """CFO cannot patch email rules."""
    tag = uuid.uuid4().hex[:8]
    _make_user(db_session, f"cfo+{tag}@emb.global", Role.CFO)
    db_session.commit()
    _login(client, f"cfo+{tag}@emb.global")
    rule = _get_rule(db_session, "DAILY_DIGEST")
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule.id}",
        json={"is_active": True},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 403, resp.json()


def test_patch_email_rule_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot patch email rules."""
    tag = uuid.uuid4().hex[:8]
    _make_user(db_session, f"pending+{tag}@emb.global", Role.PENDING)
    db_session.commit()
    _login(client, f"pending+{tag}@emb.global")
    rule = _get_rule(db_session, "DAILY_DIGEST")
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule.id}",
        json={"is_active": True},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 403, resp.json()


# ---------------------------------------------------------------------------
# 4. Recipients validation — invalid email → 422
# ---------------------------------------------------------------------------


def test_patch_email_rule_invalid_email_422(client: TestClient, db_session: Session) -> None:
    """Invalid email in recipients_json → 422 from Pydantic validation."""
    _login_as_admin(client)
    rule = _get_rule(db_session, "DAILY_DIGEST")
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule.id}",
        json={"recipients_json": ["not-an-email", "valid@emb.global"]},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 422, resp.json()


def test_patch_email_rule_valid_emails(client: TestClient, db_session: Session) -> None:
    """Valid emails are stored normalised (lowercase)."""
    _login_as_admin(client)
    rule = _get_rule(db_session, "PUBLISH_NOTIF")
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule.id}",
        json={"recipients_json": ["Finance@EMB.Global"]},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["recipients_json"] == ["finance@emb.global"]


# ---------------------------------------------------------------------------
# 5. rule_type in PATCH body is silently ignored (extra fields dropped)
# ---------------------------------------------------------------------------


def test_patch_email_rule_rule_type_ignored(client: TestClient, db_session: Session) -> None:
    """Supplying rule_type in PATCH body does not change it (extra field dropped)."""
    _login_as_admin(client)
    rule = _get_rule(db_session, "DAILY_DIGEST")
    original_rule_type = rule.rule_type
    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule.id}",
        # Include rule_type — Pydantic v2 drops extra fields by default.
        json={"rule_type": "PUBLISH_NOTIF", "notes": "attempt to change rule_type"},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["rule_type"] == original_rule_type  # unchanged


# ---------------------------------------------------------------------------
# 6. Audit log row written on PATCH
# ---------------------------------------------------------------------------


def test_patch_email_rule_writes_audit_log(client: TestClient, db_session: Session) -> None:
    """PATCH writes an EMAIL_RULE_UPDATED audit_log row with before/after."""
    _login_as_admin(client)
    rule = _get_rule(db_session, "WEEKLY_DEFAULT_CP_NUDGE")
    rule_id = str(rule.id)

    csrf_token = _csrf(client)
    resp = client.patch(
        f"/admin/email-rules/{rule_id}",
        json={"is_active": True, "notes": "audit test"},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert resp.status_code == 200, resp.json()

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "EMAIL_RULE_UPDATED",
            AuditLog.entity_type == "email_rules",
            AuditLog.entity_id == rule.id,
        )
    )
    assert audit is not None, "No audit log row written after PATCH"
    assert audit.before is not None
    assert audit.after is not None
    assert "is_active" in audit.before
    assert audit.after["is_active"] is True
    assert audit.after["notes"] == "audit test"


# ---------------------------------------------------------------------------
# 7. 3 seeded rows present (migration guard)
# ---------------------------------------------------------------------------


def test_seeded_rows_present(db_session: Session) -> None:
    """Migration 0011 seeds exactly the 3 canonical rule_type rows."""
    rows = db_session.scalars(select(EmailRule)).all()
    rule_types = {r.rule_type for r in rows}
    assert "DAILY_DIGEST" in rule_types
    assert "WEEKLY_DEFAULT_CP_NUDGE" in rule_types
    assert "PUBLISH_NOTIF" in rule_types

    # Seeded defaults
    digest = _get_rule(db_session, "DAILY_DIGEST")
    assert digest.is_active is False
    assert digest.cron_schedule == "0 9 * * *"
    assert digest.recipients_json == []

    nudge = _get_rule(db_session, "WEEKLY_DEFAULT_CP_NUDGE")
    assert nudge.is_active is False
    assert nudge.cron_schedule == "0 9 * * 1"

    notif = _get_rule(db_session, "PUBLISH_NOTIF")
    assert notif.is_active is True
    assert notif.cron_schedule is None
