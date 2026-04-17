# syntax=docker/dockerfile:1.7

# =============================================================================
# Receivables Ageing Dashboard — Railway-ready multi-stage build
#
# Stages:
#   1. frontend-builder → builds React (Vite) into /app/frontend/dist
#   2. backend-dev      → used by docker-compose for local dev (uv + reload)
#   3. runtime          → production image for Railway (FastAPI serves API
#                         + static React bundle via StaticFiles mount)
#
# Railway picks the final `runtime` stage by default.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — frontend builder
# -----------------------------------------------------------------------------
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2 — backend dev (used by docker-compose for local dev)
# -----------------------------------------------------------------------------
FROM python:3.12-slim AS backend-dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen
ENV PATH="/app/.venv/bin:${PATH}"
ENV PYTHONPATH="/app/backend/src:${PYTHONPATH}"

COPY backend/ ./backend/

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# -----------------------------------------------------------------------------
# Stage 3 — runtime (Railway production image)
# -----------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8000

COPY --from=ghcr.io/astral-sh/uv:0.6 /uv /usr/local/bin/uv

# Non-root user for runtime
RUN groupadd -r app && useradd -r -g app app

WORKDIR /app

# Install runtime deps only (no dev extras)
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:${PATH}"
ENV PYTHONPATH="/app/backend/src:${PYTHONPATH}"

# Backend source
COPY backend/ ./backend/

# Frontend production bundle (served via FastAPI StaticFiles — spec §11)
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8000}/health || exit 1

# Railway sets $PORT; respect it.
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
