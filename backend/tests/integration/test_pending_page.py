"""Integration tests for /auth/pending and /auth/me endpoints.

Uses the function-scoped `client` fixture (DB-backed, per-test rollback).
All tests run with auth_provider="stub" (the Settings default).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.rbac import Role

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


class TestPendingPagePendingUser:
    """PENDING users should see the pending approval page."""

    def test_pending_page_shown_for_pending_user(self, client: TestClient) -> None:
        """A brand-new PENDING user should see the pending page at /auth/pending."""
        # Create a new PENDING user via stub login
        r = client.get(
            "/auth/google/callback?stub_email=newpending@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302
        assert r.headers["location"] == "/auth/pending"

        # Now access the pending page
        r = client.get("/auth/pending")
        assert r.status_code == 200
        assert b"Account pending approval" in r.content
        assert b"newpending@emb.global" in r.content
        assert b"admin approval" in r.content
        assert b"/auth/logout" in r.content


class TestPendingPageNonPendingUser:
    """Non-PENDING users should be redirected to / instead of seeing the pending page."""

    def test_pending_page_redirects_non_pending_user(
        self, client: TestClient, db_session: Session
    ) -> None:
        """A promoted user (e.g. ADMIN) should be redirected from /auth/pending to /."""
        # Tejaswa is seeded as ADMIN. Log them in via stub path
        r = client.get(
            "/auth/google/callback?stub_email=tejaswa.sharma@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302

        # ADMIN user should be redirected to / when accessing /auth/pending
        r = client.get("/auth/pending", follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "/"


class TestPendingPageUnauthenticated:
    """Unauthenticated users should get 401."""

    def test_pending_page_unauthenticated_401(self, client: TestClient) -> None:
        """No session cookie → 401 (get_current_user raises 401)."""
        r = client.get("/auth/pending")
        assert r.status_code == 401


class TestMeEndpoint:
    """GET /auth/me returns current user info."""

    def test_me_returns_user_info(self, client: TestClient, db_session: Session) -> None:
        """Sign in via stub → GET /auth/me → 200, JSON has correct fields."""
        email = "mecheck@emb.global"

        # Create user via callback
        r = client.get(
            f"/auth/google/callback?stub_email={email}",
            follow_redirects=False,
        )
        assert r.status_code == 302

        # Get user info
        r = client.get("/auth/me")
        assert r.status_code == 200

        data = r.json()
        assert data["email"] == email
        assert data["name"] == "Stub User"
        assert data["role"] == Role.PENDING.value
        assert "id" in data
        assert isinstance(data["id"], str)
        # entity_id_scope should be None for new users
        assert data["entity_id_scope"] is None

    def test_me_returns_admin_user_info(self, client: TestClient, db_session: Session) -> None:
        """ADMIN user (seeded) should have correct role in /auth/me."""
        # Log in Tejaswa (seeded as ADMIN)
        r = client.get(
            "/auth/google/callback?stub_email=tejaswa.sharma@emb.global",
            follow_redirects=False,
        )
        assert r.status_code == 302

        # Get user info
        r = client.get("/auth/me")
        assert r.status_code == 200

        data = r.json()
        assert data["email"] == "tejaswa.sharma@emb.global"
        assert data["role"] == Role.ADMIN.value

    def test_me_unauthenticated_401(self, client: TestClient) -> None:
        """No session cookie → 401."""
        r = client.get("/auth/me")
        assert r.status_code == 401


class TestMeEndpointPendingRoleAccess:
    """PENDING role users should be able to call /auth/me (no role restriction)."""

    def test_pending_user_can_call_me_endpoint(self, client: TestClient) -> None:
        """PENDING user should be able to call /auth/me and get their info."""
        email = "pending_me@emb.global"

        # Create PENDING user
        r = client.get(
            f"/auth/google/callback?stub_email={email}",
            follow_redirects=False,
        )
        assert r.status_code == 302

        # PENDING user should be able to call /auth/me
        r = client.get("/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == email
        assert data["role"] == Role.PENDING.value
