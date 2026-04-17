#!/usr/bin/env bash
# Railway entrypoint: run migrations then start uvicorn.
# Errors propagate via `set -euo pipefail` so Railway marks the deploy failed
# with a visible traceback in the logs (vs a silent exit).

set -euo pipefail

: "${PORT:=8000}"

/app/.venv/bin/alembic -c backend/alembic.ini upgrade head

exec /app/.venv/bin/python -u -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT}"
