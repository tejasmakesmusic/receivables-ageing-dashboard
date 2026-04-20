#!/usr/bin/env bash
# Local dev environment — backend on :8000 + frontend on :5173.
# Ctrl-C stops both. Prefixes output [BE]/[FE] so the streams don't interleave
# unreadably.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BE_PORT=8000
FE_PORT=5173

# Release ports if a stale process is holding them.
for port in "$BE_PORT" "$FE_PORT"; do
  if lsof -ti tcp:"$port" >/dev/null 2>&1; then
    echo "[dev] port $port busy — killing existing"
    lsof -ti tcp:"$port" | xargs kill -9 2>/dev/null || true
    sleep 0.3
  fi
done

# Color prefixes for prefixed output.
BE_PREFIX=$'\033[1;34m[BE]\033[0m'
FE_PREFIX=$'\033[1;32m[FE]\033[0m'

# Clean shutdown: kill all children on SIGINT/SIGTERM.
cleanup() {
  echo ""
  echo "[dev] shutting down..."
  # Kill every background job in this shell
  jobs -p | xargs -r kill 2>/dev/null || true
  # Give uvicorn a chance to release its socket
  sleep 0.3
  wait 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "[dev] backend: http://127.0.0.1:${BE_PORT}"
echo "[dev] frontend: http://127.0.0.1:${FE_PORT}"
echo "[dev] Ctrl-C to stop both"
echo ""

# Backend — uvicorn with --reload so edits hot-reload.
(
  uv run uvicorn app.main:app \
    --reload \
    --app-dir backend/src \
    --host 127.0.0.1 \
    --port "$BE_PORT" 2>&1 | sed "s|^|${BE_PREFIX} |"
) &

# Frontend — Vite dev server.
(
  cd frontend && npm run dev 2>&1 | sed "s|^|${FE_PREFIX} |"
) &

wait
