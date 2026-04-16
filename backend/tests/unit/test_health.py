"""Smoke test — /health returns ok. Ensures pytest finds >0 tests from day 1.

Uses `http_client` (session-scoped, no DB) because the current /health
impl is a static stub with no DB ping. When Task 9 grows /health a real
DB ping, move this test to backend/tests/integration/ and switch to the
function-scoped `client` fixture — at that point it's an integration
test by definition and belongs on the DB-backed fixture path.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_health(http_client: TestClient) -> None:
    r = http_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "env" in body
