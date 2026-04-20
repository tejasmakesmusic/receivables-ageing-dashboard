"""Global pytest fixtures — DB session (per-test), HTTP client.

Strategy:
- Session-scoped Neon branch (or fallback to DATABASE_URL_DIRECT)
- Session-scoped engine pointed at the branch
- Schema built once via `alembic upgrade head` against that engine
- Per-test DB session wrapped in a nested transaction that rolls back
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

import dotenv
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from tests.neon_branch import neon_branch_dsn

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.engine import Engine


PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Load .env into os.environ so Neon credentials + DATABASE_URL_DIRECT are available
# before any fixture runs. pydantic-settings loads .env lazily per-instantiation;
# os.environ doesn't get populated until we do this explicitly.
dotenv.load_dotenv(PROJECT_ROOT / ".env", override=False)


@pytest.fixture(scope="session")
def _branch_dsn() -> Iterator[str]:
    with neon_branch_dsn() as dsn:
        yield dsn


@pytest.fixture(scope="session")
def branch_dsn(_branch_dsn: str) -> str:
    """Public alias that exposes the Neon branch DSN to concurrency tests.

    The ``ThreadSessionFactory`` in ``parallel_db.py`` needs a raw DSN string
    to create per-thread NullPool engines that exercise real row-level locks.
    Concurrency tests should request this fixture rather than ``_branch_dsn``
    (the private fixture is consumed by ``test_engine`` which also sets env vars).
    """
    return _branch_dsn


@pytest.fixture(scope="session")
def test_engine(_branch_dsn: str) -> Iterator[Engine]:
    # Point app config at the branch for this test session
    os.environ["DATABASE_URL"] = _branch_dsn
    os.environ["DATABASE_URL_DIRECT"] = _branch_dsn
    # Force stub auth for integration tests regardless of the developer's .env.
    # Many tests call `/auth/google/callback?stub_email=...`; that helper only
    # works when auth_provider == "stub". Without this override, a developer
    # whose .env has AUTH_PROVIDER=google (e.g. because they're also testing
    # real Google OAuth locally) would see every auth-dependent integration
    # test fail with "auth.state_mismatch".
    os.environ["AUTH_PROVIDER"] = "stub"
    # Reset cached settings so the env change takes effect
    from app.config import get_settings

    get_settings.cache_clear()

    engine = create_engine(_branch_dsn, pool_pre_ping=True, future=True)

    # Apply migrations — no-op if no revisions exist yet (Task 7 adds 0001_initial).
    # alembic.ini lives at backend/alembic.ini and must run from PROJECT_ROOT.
    subprocess.run(
        ["uv", "run", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        cwd=PROJECT_ROOT,
        check=True,
        env={**os.environ, "DATABASE_URL_DIRECT": _branch_dsn},
    )

    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine: Engine) -> Iterator[Session]:
    """Per-test session with transaction rollback.

    Each test sees a clean DB because we roll back at teardown.
    The bootstrap seed (0002) data IS present across tests because
    migrations run once at session scope.

    Cleanup is nested so a failure in one step (e.g. session.close()
    raises on a broken connection) does not prevent the outer rollback
    + connection close from running — which would otherwise leak a
    Postgres connection per failed test.
    """
    connection = test_engine.connect()
    transaction = connection.begin()
    session_local = sessionmaker(bind=connection, expire_on_commit=False)
    session = session_local()

    try:
        yield session
    finally:
        try:
            session.close()
        finally:
            try:
                transaction.rollback()
            finally:
                connection.close()


@pytest.fixture(scope="session")
def http_client() -> Iterator[TestClient]:
    """Session-scoped TestClient with NO DB dependency.

    Use for tests that exercise routes independent of DB state (e.g.
    `/health` while it remains a static stub, OpenAPI shape checks,
    middleware smoke). When a route grows a DB dependency, migrate its
    test to the function-scoped `client` fixture below so it participates
    in the per-test transaction rollback.
    """
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    """TestClient that uses the per-test DB session via dependency override."""
    from app.api.deps import db_session as db_session_dep
    from app.main import app

    def _override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[db_session_dep] = _override
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(db_session_dep, None)
