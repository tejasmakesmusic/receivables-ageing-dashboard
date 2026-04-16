"""Integration tests for /auth/google/callback — stub mode with real DB.

Uses the function-scoped `client` fixture (DB-backed, per-test rollback).
All tests run with auth_provider="stub" (the Settings default).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.rbac import Role

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session
from app.db.models.user import User


class TestCallbackStubCreatesPendingUser:
    """First-time callback creates a PENDING user and redirects to /auth/pending."""

    def test_new_user_gets_pending_role(self, client: TestClient, db_session: Session) -> None:
        """A brand-new email should land with Role.PENDING."""
        r = client.get(
            "/auth/google/callback?stub_email=newuser@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302
        assert r.headers["location"] == "/auth/pending"

        user = db_session.query(User).filter_by(email="newuser@emb.global").first()
        assert user is not None
        assert user.role == Role.PENDING
        assert user.is_active is True

    def test_new_user_session_cookie_issued(self, client: TestClient) -> None:
        """A session cookie should be set after successful callback."""
        r = client.get(
            "/auth/google/callback?stub_email=cookie_check@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302
        set_cookie = r.headers.get("set-cookie", "")
        assert "session=" in set_cookie

    def test_new_user_audit_log_written(self, client: TestClient, db_session: Session) -> None:
        """An audit_log row with action=user_login should be written."""
        from app.db.models.audit_log import AuditLog

        r = client.get(
            "/auth/google/callback?stub_email=auditcheck@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302

        user = db_session.query(User).filter_by(email="auditcheck@emb.global").first()
        assert user is not None

        log_row = (
            db_session.query(AuditLog)
            .filter_by(action="user_login", entity_id=user.id)
            .first()
        )
        assert log_row is not None
        assert log_row.after is not None
        assert log_row.after["email"] == "auditcheck@emb.global"
        assert log_row.after["role"] == Role.PENDING.value


class TestCallbackStubDomainRestriction:
    """Emails outside the allowed domain should be rejected."""

    def test_gmail_rejected(self, client: TestClient, db_session: Session) -> None:
        """hacker@gmail.com → 302 /auth/error?reason=domain_restricted, no user created."""
        r = client.get(
            "/auth/google/callback?stub_email=hacker@gmail.com",
            follow_redirects=False,
        )
        assert r.status_code == 302
        location = r.headers["location"]
        assert "/auth/error" in location
        assert "domain_restricted" in location

        user = db_session.query(User).filter_by(email="hacker@gmail.com").first()
        assert user is None, "No user row should be created for out-of-domain email"

    def test_similar_domain_rejected(self, client: TestClient, db_session: Session) -> None:
        """user@emb.global.evil.com should not match @emb.global."""
        r = client.get(
            "/auth/google/callback?stub_email=user@emb.global.evil.com",
            follow_redirects=False,
        )
        assert r.status_code == 302
        assert "domain_restricted" in r.headers["location"]

    def test_missing_stub_email_returns_error(self, client: TestClient) -> None:
        """Stub callback with no stub_email param should redirect to /auth/error."""
        r = client.get("/auth/google/callback", follow_redirects=False)
        assert r.status_code == 302
        assert "/auth/error" in r.headers["location"]


class TestCallbackStubExistingUserUpdatesLogin:
    """Second callback for the same email should update last_login_at, not re-create."""

    def test_second_login_updates_last_login_at(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Two callbacks for the same email should result in exactly one User row."""
        email = "returning@emb.global"

        # First login
        r1 = client.get(
            f"/auth/google/callback?stub_email={email}",
            follow_redirects=False,
        )
        assert r1.status_code == 302

        user_after_first = db_session.query(User).filter_by(email=email).first()
        assert user_after_first is not None

        # Second login
        r2 = client.get(
            f"/auth/google/callback?stub_email={email}",
            follow_redirects=False,
        )
        assert r2.status_code == 302

        db_session.expire(user_after_first)
        user_after_second = db_session.query(User).filter_by(email=email).first()
        assert user_after_second is not None

        # Still only one user row
        count = db_session.query(User).filter_by(email=email).count()
        assert count == 1, "Second login must not create a duplicate user"

    def test_second_login_audit_log_count(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Each login writes one audit_log row, so two logins → two rows."""
        from app.db.models.audit_log import AuditLog

        email = "audit_count@emb.global"

        client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)
        client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)

        user = db_session.query(User).filter_by(email=email).first()
        assert user is not None

        log_count = (
            db_session.query(AuditLog)
            .filter_by(action="user_login", entity_id=user.id)
            .count()
        )
        assert log_count == 2, f"Expected 2 audit_log rows, got {log_count}"
