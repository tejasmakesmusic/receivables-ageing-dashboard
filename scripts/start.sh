#!/usr/bin/env bash
# Railway entrypoint: run migrations then start uvicorn.
# Errors propagate via `set -euo pipefail` so Railway marks the deploy failed.

set -euo pipefail

: "${PORT:=8000}"

echo "[start.sh] running alembic migrations"
/app/.venv/bin/alembic -c backend/alembic.ini upgrade head

echo "[start.sh] migrations done; starting uvicorn on 0.0.0.0:${PORT}"
exec /app/.venv/bin/python -u -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT}"
