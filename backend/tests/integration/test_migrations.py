"""Migration tests — upgrade head / downgrade base / schema correctness."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

# PROJECT_ROOT is 3 levels up from this file:
# backend/tests/integration/test_migrations.py -> backend/tests/integration
# -> backend/tests -> backend -> PROJECT_ROOT
PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _alembic(args: list[str]) -> subprocess.CompletedProcess[str]:
    """Run alembic via uv, rooted at PROJECT_ROOT with backend/alembic.ini.

    Matches the pattern used in conftest.py's test_engine fixture so
    both go through the same config file discovery path.
    """
    return subprocess.run(
        ["uv", "run", "alembic", "-c", "backend/alembic.ini", *args],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.integration
def test_migration_files_parse() -> None:
    """alembic heads must succeed — proves every versions/*.py is importable."""
    result = _alembic(["heads"])
    assert result.returncode == 0, result.stderr
    assert "0001" in result.stdout or "initial" in result.stdout
