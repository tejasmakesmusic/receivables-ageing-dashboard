"""FastAPI entrypoint. Health check only — real routes are added per milestone."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app.api.deps import db_session
from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.config import router as config_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.exceptions import router as exceptions_router
from app.api.routes.follow_ups import router as follow_ups_router
from app.api.routes.invoices import router as invoices_router
from app.api.routes.parties import router as parties_router
from app.api.routes.snapshots import router as snapshots_router
from app.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import CSRFMiddleware, RequestIDMiddleware
from app.core.scheduler import shutdown_scheduler, start_scheduler
from app.core.startup import assert_prod_auth_safe

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.orm import Session

configure_logging()  # Must run BEFORE any get_logger() call (cache_logger_on_first_use=True)
settings = get_settings()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Safety check must fire before scheduler or any request handler.
    assert_prod_auth_safe(settings)
    start_scheduler()
    try:
        yield
    finally:
        shutdown_scheduler()


app = FastAPI(
    title="Receivables Ageing Dashboard",
    version="0.1.0",
    description=(
        "Internal EMB Global AR ageing platform (India/Tally + UAE/Xero). "
        "Scaffold only — routes added per milestone."
    ),
    lifespan=lifespan,
)

# Middleware registration: last added = outermost (runs first).
# RequestIDMiddleware must be outermost so request_id is bound before everything else.
app.add_middleware(CSRFMiddleware)  # inner
app.add_middleware(RequestIDMiddleware)  # outer — added last, runs first

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(admin_router, prefix="/admin", tags=["admin"])
app.include_router(snapshots_router, prefix="/snapshots", tags=["snapshots"])
app.include_router(config_router, prefix="/config", tags=["config"])
app.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])
app.include_router(invoices_router, prefix="/invoices", tags=["invoices"])
app.include_router(parties_router, prefix="/parties", tags=["parties"])
# Exception routes have mixed prefixes (/invoices/:id/exceptions and /exceptions)
# so the router is registered at root with its own prefixes inline
app.include_router(exceptions_router, tags=["exceptions"])
app.include_router(follow_ups_router, prefix="/follow-ups", tags=["follow-ups"])


@app.get("/health", tags=["meta"])
def health(session: Session = Depends(db_session)) -> dict[str, str]:  # noqa: B008
    """Liveness probe — used by Railway healthcheck.

    Returns app status + env + DB connectivity.
    On DB error: status stays 'ok' (app is up), db field is 'error'.
    """
    result: dict[str, str] = {"status": "ok", "env": settings.app_env}

    try:
        session.execute(text("SELECT 1"))
        result["db"] = "ok"
    except Exception as e:
        # Log internally — do NOT surface raw exception text in the response
        # because /health is unauthenticated and the error may contain
        # DSN fragments (host, port, credentials).
        log.warning("health.db_ping_failed", error=str(e))
        result["db"] = "error"

    return result
