"""Startup-time safety assertions.

Call `assert_prod_auth_safe` from the FastAPI lifespan *before* any
scheduler or request-handler boots.  This ensures misconfigured deploys
crash visibly at process start rather than silently granting admin access
to the first visitor.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.logging import get_logger

if TYPE_CHECKING:
    from app.config import Settings

log = get_logger(__name__)


def assert_prod_auth_safe(settings: Settings) -> None:
    """Fail fast if APP_ENV=production and AUTH_PROVIDER=stub.

    Stub auth auto-creates an ADMIN user on first hit — unacceptable in
    prod. This guard is meant to fire at process startup, before any
    request is served, so misconfigured deploys crash visibly instead of
    silently granting admin to the first visitor.

    Raises:
        RuntimeError: when app_env is 'production' and auth_provider is 'stub'.
    """
    if settings.app_env == "production" and settings.auth_provider == "stub":
        msg = (
            "FATAL: AUTH_PROVIDER=stub is not allowed in production. "
            "Set AUTH_PROVIDER=google (and configure Google OAuth credentials) "
            "before deploying. Refusing to start."
        )
        log.critical(
            "startup.unsafe_auth_provider",
            app_env=settings.app_env,
            auth_provider=settings.auth_provider,
        )
        raise RuntimeError(msg)

    log.info(
        "startup.auth_provider_check_passed",
        app_env=settings.app_env,
        auth_provider=settings.auth_provider,
    )
