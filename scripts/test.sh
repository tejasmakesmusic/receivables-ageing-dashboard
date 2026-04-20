#!/usr/bin/env bash
# Run the test suite.
#
# Modes:
#   --fast       Backend unit (no DB) + frontend typecheck + frontend vitest
#                (default; ~30s on a warm cache)
#   --backend    Full backend suite (Neon branch per session; ~10-20 min)
#   --frontend   Frontend typecheck + lint + vitest + build
#   --lint       Ruff + mypy on backend, tsc + eslint on frontend
#   --full       Everything above
#
# Exits non-zero on the first failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

MODE="${1:-fast}"
MODE="${MODE#--}"

BE_HEADER=$'\033[1;34m── BACKEND ──\033[0m'
FE_HEADER=$'\033[1;32m── FRONTEND ──\033[0m'
LINT_HEADER=$'\033[1;35m── LINT ──\033[0m'

run_backend_unit() {
  printf '\n%s unit (no DB)\n' "$BE_HEADER"
  uv run pytest backend/tests/unit -q -m "not slow"
}

run_backend_full() {
  printf '\n%s full suite (Neon branch per session)\n' "$BE_HEADER"
  uv run pytest backend/tests/ -q -p no:randomly
}

run_backend_lint() {
  printf '\n%s ruff + mypy\n' "$LINT_HEADER"
  uv run ruff check .
  uv run mypy backend/src
}

run_frontend() {
  printf '\n%s typecheck + lint + vitest + build\n' "$FE_HEADER"
  (
    cd "$REPO_ROOT/frontend"
    npm run typecheck
    npm run lint
    npm run test -- --run
    npm run build
  )
}

run_frontend_fast() {
  printf '\n%s typecheck + vitest\n' "$FE_HEADER"
  (
    cd "$REPO_ROOT/frontend"
    npm run typecheck
    npm run test -- --run
  )
}

case "$MODE" in
  fast)
    run_backend_unit
    run_frontend_fast
    ;;
  backend)
    run_backend_full
    run_backend_lint
    ;;
  frontend)
    run_frontend
    ;;
  lint)
    run_backend_lint
    (cd "$REPO_ROOT/frontend" && npm run typecheck && npm run lint)
    ;;
  full)
    run_backend_lint
    run_backend_full
    run_frontend
    ;;
  -h|--help|help)
    cat <<EOF
usage: $0 [--fast|--backend|--frontend|--lint|--full]

Default: --fast (backend unit tests + frontend typecheck + vitest, ~30s).
See script header for full matrix.
EOF
    exit 0
    ;;
  *)
    echo "usage: $0 [--fast|--backend|--frontend|--lint|--full]" >&2
    exit 2
    ;;
esac

printf '\n\033[1;32m[test] DONE\033[0m\n'
