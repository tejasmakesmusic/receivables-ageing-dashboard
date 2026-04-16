"""FastAPI entrypoint. Health check only — real routes are added per milestone."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app.api.deps import db_session
from app.config import get_settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

settings = get_settings()
log = get_logger(__name__)

app = FastAPI(
    title="Receivables Ageing Dashboard",
    version="0.1.0",
    description=(
        "Internal EMB Global AR ageing platform (India/Tally + UAE/Xero). "
        "Scaffold only — routes added per milestone."
    ),
)


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
