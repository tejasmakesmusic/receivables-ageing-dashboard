"""Config tests — ensure new M1 settings are present and typed."""

from __future__ import annotations

import pytest

from app.config import Settings


def test_auth_provider_default_is_stub() -> None:
    # Default is unconditional — the production guard lives in app/core/startup.py,
    # not in the field default. See Task 12.
    s = Settings()
    assert s.auth_provider == "stub"


def test_auth_provider_accepts_google() -> None:
    s = Settings(auth_provider="google")
    assert s.auth_provider == "google"


def test_auth_provider_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        Settings(auth_provider="facebook")  # type: ignore[arg-type]
