"""Unit tests for the stub-in-prod startup guard.

Covers:
  - stub + dev     → passes (no exception)
  - google + prod  → passes (no exception)
  - stub + prod    → raises RuntimeError with expected message fragment
  - google + dev   → passes (no exception)
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.core.startup import assert_prod_auth_safe


def test_stub_dev_passes() -> None:
    """stub auth in development is the normal local-dev setup — must pass."""
    settings = Settings(app_env="development", auth_provider="stub")
    # Should not raise
    assert_prod_auth_safe(settings)


def test_google_prod_passes() -> None:
    """google auth in production is the intended state — must pass."""
    settings = Settings(app_env="production", auth_provider="google")
    # Should not raise
    assert_prod_auth_safe(settings)


def test_stub_prod_raises() -> None:
    """stub auth in production is a misconfiguration — must raise RuntimeError."""
    settings = Settings(app_env="production", auth_provider="stub")
    with pytest.raises(RuntimeError, match="AUTH_PROVIDER=stub is not allowed in production"):
        assert_prod_auth_safe(settings)


def test_google_dev_passes() -> None:
    """google auth in development is fine (e.g. staging smoke-test) — must pass."""
    settings = Settings(app_env="development", auth_provider="google")
    # Should not raise
    assert_prod_auth_safe(settings)


def test_stub_staging_passes() -> None:
    """stub auth in staging is allowed — guard only blocks production."""
    settings = Settings(app_env="staging", auth_provider="stub")
    # Should not raise
    assert_prod_auth_safe(settings)
