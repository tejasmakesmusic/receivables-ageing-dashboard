"""Config tests — ensure new M1 settings are present and typed."""

from __future__ import annotations

import pytest

from app.config import Settings


def test_auth_provider_defaults_to_stub_in_dev() -> None:
    s = Settings(app_env="development")
    assert s.auth_provider == "stub"


def test_auth_provider_accepts_google() -> None:
    s = Settings(auth_provider="google")
    assert s.auth_provider == "google"


def test_auth_provider_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        Settings(auth_provider="facebook")  # type: ignore[arg-type]
