"""FastAPI entrypoint. Health check only — real routes are added per milestone."""

from __future__ import annotations

from fastapi import FastAPI

from app.config import get_settings

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
def health() -> dict[str, str]:
    """Liveness probe — used by Railway healthcheck."""
    return {"status": "ok", "env": settings.app_env}
