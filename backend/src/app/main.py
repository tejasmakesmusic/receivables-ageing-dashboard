"""FastAPI entrypoint. Health check only — real routes are added per milestone."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app.api.deps import db_session
from app.config import get_settings

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

settings = get_settings()

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
        result["db"] = "error"
        result["db_error"] = str(e)

    return result
