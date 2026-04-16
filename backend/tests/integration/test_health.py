"""Integration test for /health endpoint with DB ping.

Moved from backend/tests/unit/test_health.py when /health gained a real DB
ping in Task 9. Now uses the function-scoped `client` fixture (DB-backed).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_health_returns_ok(client: TestClient) -> None:
    """GET /health returns 200 with status=ok, db=ok, and env field."""
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert "env" in body


def test_health_db_field_present(client: TestClient) -> None:
    """GET /health always includes 'db' key (belt-and-suspenders)."""
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert "db" in body
