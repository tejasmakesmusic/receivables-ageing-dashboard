"""Integration tests for /admin/users endpoints.

Uses the function-scoped `client` fixture (DB-backed, per-test rollback).
All tests run with auth_provider="stub" (the Settings default).

Admin user: tejaswa.sharma@emb.global (seeded as ADMIN in 0002 migration).
Pending users created via stub callback.

NOTE on session ordering:
  The TestClient stores exactly one session cookie at a time. Calling
  _create_pending() issues a new cookie (for the pending user), clobbering
  any existing admin cookie. Always call _login_as_admin() AFTER
  _create_pending() so the final cookie is the admin's.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _login_as_admin(client: TestClient) -> None:
    """Establish a session cookie for the seeded ADMIN user."""
    client.get(
        "/auth/google/callback?stub_email=tejaswa.sharma@emb.global",
        follow_redirects=False,
    )


def _create_pending(client: TestClient, email: str) -> None:
    """Create a PENDING user by going through the stub OAuth callback.

    Side-effect: the client's session cookie is now for this pending user.
    Call _login_as_admin() after this if you need admin access next.
    """
    client.get(
        f"/auth/google/callback?stub_email={email}",
        follow_redirects=False,
    )


def _csrf_token(client: TestClient) -> str:
    """Return the current csrf_token cookie value.

    CSRFMiddleware sets the cookie on every response, including the GET
    callbacks above, so by the time tests call this there is always a value.
    Falls back to empty string — the test will then receive 403, which is
    intentional for negative tests.
    """
    return client.cookies.get("csrf_token", "")


def _post_with_csrf(client: TestClient, url: str, data: dict | None = None) -> object:
    """POST with the csrf_token form field automatically injected."""
    payload = dict(data or {})
    payload["csrf_token"] = _csrf_token(client)
    return client.post(url, data=payload, follow_redirects=False)


# ---------------------------------------------------------------------------
# Test 1: GET /admin/users requires ADMIN role
# ---------------------------------------------------------------------------


class TestAdminUsersListRequiresAdminRole:
    def test_admin_users_list_requires_admin_role(
        self, client: TestClient, db_session: Session
    ) -> None:
        """A PENDING user must receive 403 when accessing GET /admin/users."""
        _create_pending(client, "pending_noaccess@emb.global")
        # Cookie is now for the PENDING user — admin check must reject
        r = client.get("/admin/users")
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# Test 2: GET /admin/users returns HTML for ADMIN
# ---------------------------------------------------------------------------


class TestAdminUsersListReturnsHtml:
    def test_admin_users_list_returns_html(self, client: TestClient) -> None:
        """ADMIN user gets 200 HTML response containing 'User Management'."""
        _login_as_admin(client)
        r = client.get("/admin/users")
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        assert b"User Management" in r.content


# ---------------------------------------------------------------------------
# Test 3: POST /admin/users/{user_id}/approve changes role
# ---------------------------------------------------------------------------


class TestApproveUserChangesRole:
    def test_approve_pending_user_changes_role(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Approving a PENDING user with role=ANALYST sets role to ANALYST and redirects."""
        _create_pending(client, "pendingapprove@emb.global")
        _login_as_admin(client)  # must come after _create_pending

        user = db_session.query(User).filter_by(email="pendingapprove@emb.global").first()
        assert user is not None
        assert user.role == Role.PENDING

        r = _post_with_csrf(client, f"/admin/users/{user.id}/approve", {"role": "ANALYST"})
        assert r.status_code == 303
        assert r.headers["location"] == "/admin/users"

        db_session.expire_all()
        user = db_session.query(User).filter_by(email="pendingapprove@emb.global").first()
        assert user is not None
        assert user.role == Role.ANALYST


# ---------------------------------------------------------------------------
# Test 4: Approve writes audit_log row
# ---------------------------------------------------------------------------


class TestApproveWritesAuditLog:
    def test_approve_writes_audit_log(self, client: TestClient, db_session: Session) -> None:
        """Approving a user writes an AuditLog row with action=role_change."""
        _create_pending(client, "auditapprove@emb.global")
        _login_as_admin(client)  # must come after _create_pending

        user = db_session.query(User).filter_by(email="auditapprove@emb.global").first()
        assert user is not None

        _post_with_csrf(client, f"/admin/users/{user.id}/approve", {"role": "ANALYST"})

        log_row = (
            db_session.query(AuditLog).filter_by(action="role_change", entity_id=user.id).first()
        )
        assert log_row is not None, "AuditLog row for role_change must exist"
        assert log_row.after is not None
        assert log_row.after["role"] == "ANALYST"


# ---------------------------------------------------------------------------
# Test 5: Deactivate sets is_active=False
# ---------------------------------------------------------------------------


class TestDeactivateUser:
    def test_deactivate_user(self, client: TestClient, db_session: Session) -> None:
        """POST /admin/users/{id}/deactivate sets is_active=False and redirects 303."""
        _create_pending(client, "deactivateme@emb.global")
        _login_as_admin(client)  # must come after _create_pending

        user = db_session.query(User).filter_by(email="deactivateme@emb.global").first()
        assert user is not None
        assert user.is_active is True

        r = _post_with_csrf(client, f"/admin/users/{user.id}/deactivate")
        assert r.status_code == 303
        assert r.headers["location"] == "/admin/users"

        db_session.expire_all()
        user = db_session.query(User).filter_by(email="deactivateme@emb.global").first()
        assert user is not None
        assert user.is_active is False


# ---------------------------------------------------------------------------
# Test 6: Reactivate sets is_active=True
# ---------------------------------------------------------------------------


class TestReactivateUser:
    def test_reactivate_user(self, client: TestClient, db_session: Session) -> None:
        """Deactivating then reactivating a user restores is_active=True."""
        _create_pending(client, "reactivateme@emb.global")
        _login_as_admin(client)  # must come after _create_pending

        user = db_session.query(User).filter_by(email="reactivateme@emb.global").first()
        assert user is not None

        # Deactivate first
        _post_with_csrf(client, f"/admin/users/{user.id}/deactivate")
        db_session.expire_all()
        user = db_session.query(User).filter_by(email="reactivateme@emb.global").first()
        assert user is not None
        assert user.is_active is False

        # Reactivate — session cookie is still Tejaswa's (ADMIN) because
        # no other callback was called between deactivate and here.
        r = _post_with_csrf(client, f"/admin/users/{user.id}/reactivate")
        assert r.status_code == 303
        assert r.headers["location"] == "/admin/users"

        db_session.expire_all()
        user = db_session.query(User).filter_by(email="reactivateme@emb.global").first()
        assert user is not None
        assert user.is_active is True


# ---------------------------------------------------------------------------
# Test 7: Approve with role=PENDING returns 422
# ---------------------------------------------------------------------------


class TestApprovePendingRoleReturns422:
    def test_approve_with_pending_role_returns_422(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Attempting to approve a user into PENDING role must return 422."""
        _create_pending(client, "pendinginto@emb.global")
        _login_as_admin(client)  # must come after _create_pending

        user = db_session.query(User).filter_by(email="pendinginto@emb.global").first()
        assert user is not None

        r = _post_with_csrf(client, f"/admin/users/{user.id}/approve", {"role": "PENDING"})
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Test 8: Edge case guards — self-deactivation and no-op deactivation
# ---------------------------------------------------------------------------


class TestAdminEdgeCases:
    def test_deactivate_self_returns_422(self, client: TestClient, db_session: Session) -> None:
        """Admin cannot deactivate their own account."""
        # Tejaswa is the seeded ADMIN
        r = client.get(
            "/auth/google/callback?stub_email=tejaswa.sharma@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302

        from app.db.models.user import User

        admin = db_session.query(User).filter_by(email="tejaswa.sharma@emb.global").first()
        assert admin is not None

        r = _post_with_csrf(client, f"/admin/users/{admin.id}/deactivate")
        assert r.status_code == 422

    def test_deactivate_already_inactive_is_noop(
        self, client: TestClient, db_session: Session
    ) -> None:
        """Deactivating an already-inactive user skips audit log write."""
        from app.db.models.audit_log import AuditLog
        from app.db.models.user import User

        email = "noop_deactivate@emb.global"
        # Create pending user
        client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)
        # Login as admin
        client.get(
            "/auth/google/callback?stub_email=tejaswa.sharma@emb.global",
            follow_redirects=False,
        )

        user = db_session.query(User).filter_by(email=email).first()
        assert user is not None

        # Deactivate once
        r = _post_with_csrf(client, f"/admin/users/{user.id}/deactivate")
        assert r.status_code == 303

        db_session.expire_all()
        user = db_session.query(User).filter_by(email=email).first()
        assert user.is_active is False

        audit_count_1 = (
            db_session.query(AuditLog)
            .filter_by(action="user_deactivate", entity_id=user.id)
            .count()
        )

        # Deactivate again — should be no-op
        r = _post_with_csrf(client, f"/admin/users/{user.id}/deactivate")
        assert r.status_code == 303

        db_session.expire_all()
        audit_count_2 = (
            db_session.query(AuditLog)
            .filter_by(action="user_deactivate", entity_id=user.id)
            .count()
        )
        assert audit_count_2 == audit_count_1, "No-op deactivation must not write audit log"
