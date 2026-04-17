"""Unit tests for auth routes — stub-mode login, logout, error page.

These tests use the session-scoped `http_client` fixture (no DB dependency)
and rely on `auth_provider` defaulting to "stub" in Settings.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


class TestLoginStub:
    """GET /auth/google/login with auth_provider=stub."""

    def test_login_stub_redirects_to_callback(self, http_client: TestClient) -> None:
        """Stub login should 302 → /auth/google/callback with stub_email param."""
        r = http_client.get("/auth/google/login", follow_redirects=False)
        assert r.status_code == 302
        location = r.headers["location"]
        assert "/auth/google/callback" in location
        assert "stub_email=" in location

    def test_login_stub_email_ends_with_emb_global(self, http_client: TestClient) -> None:
        """Stub redirect URL should carry an @emb.global address."""
        r = http_client.get("/auth/google/login", follow_redirects=False)
        location = r.headers["location"]
        # Extract stub_email value from query string
        from urllib.parse import parse_qs, urlparse

        qs = parse_qs(urlparse(location).query)
        stub_email = qs.get("stub_email", [""])[0]
        assert stub_email.endswith("@emb.global"), f"Expected @emb.global, got: {stub_email}"


class TestLogout:
    """GET /auth/logout."""

    def test_logout_redirects_to_root(self, http_client: TestClient) -> None:
        """Logout should 302 → /."""
        r = http_client.get("/auth/logout", follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "/"

    def test_logout_clears_session_cookie(self, http_client: TestClient) -> None:
        """Logout should set session cookie with max_age=0."""
        r = http_client.get("/auth/logout", follow_redirects=False)
        # Look for a Set-Cookie header that expires / zeroes the session cookie
        set_cookie = r.headers.get("set-cookie", "")
        # The cookie key is "session" and max-age should be 0
        assert "session=" in set_cookie
        assert "max-age=0" in set_cookie.lower() or "max-age=0" in set_cookie


class TestAuthError:
    """GET /auth/error."""

    def test_error_returns_html_200(self, http_client: TestClient) -> None:
        """GET /auth/error should return 200 with text/html content."""
        r = http_client.get("/auth/error?reason=test")
        assert r.status_code == 200
        assert "text/html" in r.headers["content-type"]

    def test_error_contains_reason(self, http_client: TestClient) -> None:
        """HTML body should include the reason query parameter."""
        r = http_client.get("/auth/error?reason=state_mismatch")
        assert "state_mismatch" in r.text

    def test_error_default_reason_unknown(self, http_client: TestClient) -> None:
        """When no reason param supplied, page shows 'unknown'."""
        r = http_client.get("/auth/error")
        assert r.status_code == 200
        assert "unknown" in r.text

    def test_error_escapes_html_in_reason(self, http_client: TestClient) -> None:
        """Reason param must be HTML-escaped to prevent reflected XSS."""
        r = http_client.get("/auth/error?reason=<script>alert(1)</script>")
        assert "<script>" not in r.text
        assert "&lt;script&gt;" in r.text
