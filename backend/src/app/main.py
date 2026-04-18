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
from app.api.routes.snapshots import router as snapshots_router
from app.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import CSRFMiddleware, RequestIDMiddleware

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.orm import Session

configure_logging()  # Must run BEFORE any get_logger() call (cache_logger_on_first_use=True)
settings = get_settings()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Placeholder for future startup tasks (e.g., scheduler init).
    yield


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
