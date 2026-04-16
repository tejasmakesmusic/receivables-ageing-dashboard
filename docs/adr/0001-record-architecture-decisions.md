# ADR 0001 — Record architecture decisions + scaffold stack

- **Status:** Accepted
- **Date:** 2026-04-16
- **Deciders:** Tejaswa Sharma
- **Supersedes:** —

## Context

The Receivables Ageing Dashboard is a greenfield internal tool for EMB
Global. All top-level design decisions (D1–D23) are already locked in
`02_HANDOFF_SPEC.md`. Beyond that spec, we still need a lightweight place
to capture the "why" behind subsequent architectural choices so future
Claude Code sessions (and humans) don't re-litigate them.

## Decision

1. **Adopt ADRs.** Every non-trivial architectural choice made after the
   handoff spec freeze gets its own numbered file under `docs/adr/` in the
   Michael Nygard format. Small, numbered, immutable (new ADR supersedes
   old ADR; old is never rewritten).
2. **Ratify the scaffold stack** already pinned in the handoff spec and
   bootstrap prompt:
   - Backend: Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, pydantic v2,
     pydantic-settings, structlog, APScheduler, slowapi, authlib,
     itsdangerous, openpyxl + pandas (xlsx only), rapidfuzz.
   - Package manager: `uv` (lockfile: `uv.lock`). No `requirements.txt`,
     no `pip install` directly.
   - Frontend: React 18 + Vite + TypeScript, Tailwind, shadcn/ui (added
     per-component as needed), React Router v6, TanStack Query,
     react-hook-form, zod.
   - Testing: pytest, pytest-asyncio, httpx, factory-boy, freezegun
     (backend); vitest + @testing-library/react (frontend).
   - Quality: ruff (replaces flake8/isort), black, mypy strict, prettier,
     pre-commit.
   - Hosting: Railway (D21). Single-service Dockerfile: FastAPI serves
     the built React bundle via `StaticFiles`.
   - Email: Resend OR SendGrid (D22), selected via `EMAIL_PROVIDER` env
     at deploy time.

## Consequences

- New devs and Claude Code sessions can cite "ADR-NNNN" instead of
  re-arguing a decision.
- Adding a dependency outside the list above requires a new ADR (keeps
  the stack tight — no silent bloat).
- The scaffold verification commands (`uv sync`, `docker compose up`,
  `uv run alembic upgrade head`, `uv run uvicorn ...`, `npm install && npm run dev`,
  `uv run pytest`, `uv run ruff check`, `uv run mypy backend/src`)
  are the green-light criteria for Milestone 0 being complete.

## References

- `02_HANDOFF_SPEC.md` §2 (locked decisions D1–D23)
- `03_CLAUDE_CODE_BOOTSTRAP_PROMPT.md` (tooling choices block)
- Nygard on ADRs: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
