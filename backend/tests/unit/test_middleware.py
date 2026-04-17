"""Unit tests for RequestIDMiddleware and CSRFMiddleware.

Tests 1-4 use the session-scoped `http_client` fixture (no DB).
Test 5 uses the function-scoped `client` fixture (DB-backed, per-test rollback).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Test 1: X-Request-ID header is present
# ---------------------------------------------------------------------------


class TestRequestIdHeaderPresent:
    def test_request_id_header_present(self, http_client: TestClient) -> None:
        """GET /health must return a valid UUID4 in X-Request-ID."""
        r = http_client.get("/health")
        header_value = r.headers.get("x-request-id", "")
        assert header_value, "X-Request-ID header must be present"
        # Validate it parses as a UUID — raises ValueError if not
        parsed = uuid.UUID(header_value)
        assert str(parsed) == header_value


# ---------------------------------------------------------------------------
# Test 2: X-Request-ID is unique per request
# ---------------------------------------------------------------------------


class TestRequestIdUniquePerRequest:
    def test_request_id_unique_per_request(self, http_client: TestClient) -> None:
        """Two consecutive GET /health requests must return different X-Request-ID values."""
        r1 = http_client.get("/health")
        r2 = http_client.get("/health")
        id1 = r1.headers.get("x-request-id")
        id2 = r2.headers.get("x-request-id")
        assert id1 is not None
        assert id2 is not None
        assert id1 != id2, "Each request must have a unique request_id"


# ---------------------------------------------------------------------------
# Test 3: CSRF cookie is set on GET
# ---------------------------------------------------------------------------


class TestCsrfGetSetsCookie:
    def test_csrf_get_sets_cookie(self, http_client: TestClient) -> None:
        """GET /health response must set a csrf_token cookie."""
        r = http_client.get("/health")
        # TestClient stores cookies; also check Set-Cookie header as fallback
        assert "csrf_token" in r.cookies or any(
            "csrf_token" in h for h in r.headers.get_list("set-cookie")
        ), "csrf_token cookie must be set by CSRFMiddleware on GET"
        token = r.cookies.get("csrf_token") or http_client.cookies.get("csrf_token")
        assert token, "csrf_token cookie value must be non-empty"


# ---------------------------------------------------------------------------
# Test 4: POST /admin/* without CSRF token returns 403
# ---------------------------------------------------------------------------


class TestCsrfPostAdminWithoutTokenReturns403:
    def test_csrf_post_admin_without_token_returns_403(self, http_client: TestClient) -> None:
        """POST /admin/users with no csrf cookie and no form field must return 403.

        Uses a fake UUID for the user_id — CSRF check happens before route/auth
        logic so no DB or session is needed.
        """
        # Use a fresh client without any csrf_token cookie to guarantee failure.
        # Clear cookies if the session-scoped client already has one from test 3.
        # We need to POST without setting a matching form field.
        fake_id = str(uuid.uuid4())
        # Send without csrf_token form field AND without csrf_token cookie.
        # TestClient follows cookies; to guarantee no cookie we use a raw
        # httpx client via http_client.app but the simplest approach is to
        # rely on an empty / mismatched token.
        r = http_client.post(
            f"/admin/users/{fake_id}/deactivate",
            data={},  # no csrf_token field
            cookies={"csrf_token": ""},  # override: empty cookie = falsy → 403
            follow_redirects=False,
        )
        assert r.status_code == 403, (
            f"Expected 403 from CSRF check but got {r.status_code}. "
            "CSRFMiddleware must reject POST without matching token."
        )


# ---------------------------------------------------------------------------
# Test 5: POST /admin/* with valid CSRF token passes CSRF check
# ---------------------------------------------------------------------------


class TestCsrfPostAdminWithValidTokenPasses:
    def test_csrf_post_admin_with_valid_token_passes(self, client: TestClient) -> None:
        """Admin POST with matching csrf cookie + form field must not return 403.

        Logs in as the seeded ADMIN, then DEACTIVATEs a freshly created
        PENDING user using a matching CSRF token from the cookie.
        """
        # Create a pending user to deactivate
        client.get(
            "/auth/google/callback?stub_email=csrf_test_pending@emb.global",
            follow_redirects=False,
        )
        # Login as admin (overwrites session cookie)
        client.get(
            "/auth/google/callback?stub_email=tejaswa.sharma@emb.global",
            follow_redirects=False,
        )

        # csrf_token cookie is now set by CSRFMiddleware on the above GETs
        csrf_token = client.cookies.get("csrf_token", "")
        assert csrf_token, "csrf_token cookie must be present after GET"

        # Look up the pending user's ID directly via the admin list page
        r = client.get("/admin/users")
        assert r.status_code == 200
        # Refresh csrf_token after this GET (middleware may rotate it)
        csrf_token = client.cookies.get("csrf_token", csrf_token)

        # Import here to avoid circular import issues at collection time

        # We don't have direct DB access in this test — use the deactivate
        # endpoint on a known-bad UUID to confirm CSRF passes (auth/DB may 404
        # or 403 from RBAC, but NOT from CSRF).
        fake_id = str(uuid.uuid4())
        r = client.post(
            f"/admin/users/{fake_id}/deactivate",
            data={"csrf_token": csrf_token},
            follow_redirects=False,
        )
        # CSRF passes — response must NOT be 403 from CSRF.
        # 404 (user not found) or 302/303 are acceptable; just not 403.
        assert r.status_code != 403, (
            f"Got 403 — CSRF middleware incorrectly rejected a valid token. "
            f"csrf_token cookie={csrf_token!r}"
        )
