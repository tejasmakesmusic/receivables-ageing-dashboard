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

    def test_second_login_does_not_duplicate_user(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Two callbacks for the same email must produce exactly one User row."""
        email = "returning@emb.global"

        r1 = client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)
        assert r1.status_code == 302

        first_login_at = db_session.query(User).filter_by(email=email).first().last_login_at
        assert first_login_at is not None

        r2 = client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)
        assert r2.status_code == 302

        count = db_session.query(User).filter_by(email=email).count()
        assert count == 1, "Second login must not create a duplicate user"

        db_session.expire_all()
        updated = db_session.query(User).filter_by(email=email).first()
        assert updated is not None
        assert updated.last_login_at is not None
        assert updated.last_login_at >= first_login_at, "last_login_at must be updated on re-login"

    def test_google_sub_backfill_on_existing_user(
        self, db_session: Session
    ) -> None:
        """Existing user without google_sub gets it set when provided on next login.

        The stub path always passes google_sub=None, so this tests _upsert_user
        directly with a real google_sub value to cover the backfill branch.
        """
        import uuid as _uuid
        from datetime import UTC, datetime

        from app.api.routes.auth import _upsert_user

        email = "sub_backfill@emb.global"

        # Seed user without google_sub (as if created by stub flow)
        user = User(
            id=_uuid.uuid4(),
            email=email,
            google_sub=None,
            name="Stub User",
            role=Role.PENDING,
            is_active=True,
            last_login_at=datetime.now(UTC),
        )
        db_session.add(user)
        db_session.flush()
        user_id = user.id

        # Second login comes in via Google with a real sub
        updated = _upsert_user(
            db_session,
            email=email,
            name="Stub User",
            google_sub="google-sub-12345",
        )
        db_session.flush()

        assert updated.id == user_id, "Should update the existing user, not create a new one"
        assert updated.google_sub == "google-sub-12345", "google_sub must be backfilled"

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
