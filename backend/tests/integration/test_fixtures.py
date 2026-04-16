"""Sanity check — fixtures resolve and yield usable objects."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


def test_db_session_executes_queries(db_session: Session) -> None:
    result = db_session.execute(text("SELECT 1")).scalar_one()
    assert result == 1


def test_client_hits_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
