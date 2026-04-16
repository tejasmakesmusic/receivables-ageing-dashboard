"""Global pytest fixtures — DB, HTTP client, factories.

Fixtures added as milestones land. This file exists so pytest discovers
the `backend/tests/` tree cleanly from the start.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from app.main import app

if TYPE_CHECKING:
    from collections.abc import Iterator


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    """FastAPI TestClient — upgraded to hit a real DB once migrations land."""
    with TestClient(app) as c:
        yield c
