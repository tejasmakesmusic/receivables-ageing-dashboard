"""Integration test for /health endpoint with DB ping.

Moved from backend/tests/unit/test_health.py when /health gained a real DB
ping in Task 9. Uses the function-scoped `client` fixture (DB-backed).
"""

from __future__ import annotations

from unittest.mock import MagicMock

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.api.deps import db_session
from app.main import app


def test_health_returns_ok(client: TestClient) -> None:
    """GET /health returns 200 with status=ok, db=ok, and env field."""
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert "env" in body


def test_health_db_error_path() -> None:
    """GET /health returns db=error (HTTP 200) when DB ping fails.

    Also asserts that raw exception text is NOT in the response — /health is
    unauthenticated and must not leak DSN fragments (spec info-disclosure rule).
    """
    bad_session = MagicMock()
    bad_session.execute.side_effect = OperationalError(
        "SELECT 1", {}, Exception("connection refused")
    )

    app.dependency_overrides[db_session] = lambda: bad_session
    try:
        with TestClient(app) as c:
            r = c.get("/health")
    finally:
        # Always restore — don't leak override across tests.
        app.dependency_overrides.pop(db_session, None)

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok", "App liveness should stay ok even when DB is down"
    assert body["db"] == "error"
    assert "db_error" not in body, "Raw exception string must NOT appear in unauthenticated response"
