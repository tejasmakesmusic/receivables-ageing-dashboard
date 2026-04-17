# M1 — Foundations + Deploy Skeleton — COMPLETE

**Date:** 2026-04-17
**Branch:** `feature/m1-foundations` (52 commits)
**Status:** All M1 exit criteria met except one (EMB IT SPF/DKIM request — external blocker, not ours).

---

## What shipped

| Area | Artifact |
|---|---|
| Repo | GitHub — `tejasmakesmusic/receivables-ageing-dashboard` (private) |
| DB | Alembic migrations `0001_initial` + `0002_seed_bootstrap_admin`; seeded IND + UAE entities + `tejaswa.sharma@emb.global` as ADMIN |
| Models | `Entity`, `User`, `FxRate` (D15 immutable via ORM hook + Postgres trigger + partial unique index), `AuditLog` |
| Auth | Google OAuth callback + `/auth/google/login`, `/auth/logout`, `/auth/me`, `/auth/pending`, `/auth/error`; stub mode toggle via `AUTH_PROVIDER=stub\|google` |
| Session | itsdangerous signed cookies (HttpOnly, SameSite=lax, secure flag from settings) |
| RBAC | `get_current_user` + `require_role(*Role)` factory; ADMIN/CFO/ANALYST/PENDING enforced |
| Admin UI | Jinja page at `/admin/users` — list, approve (with role selector), deactivate, reactivate, self-deactivation guard |
| Middleware | `RequestIDMiddleware` (UUID4 + structlog contextvars + X-Request-ID + access log with duration_ms), `CSRFMiddleware` (double-submit cookie, content-type aware, exempt `/auth/` + `/health`) |
| Logging | structlog JSON to stdout, configured at module import before `get_logger` |
| Config | pydantic-settings with Literal-typed `APP_ENV` + `AUTH_PROVIDER` + `APP_LOG_LEVEL` |
| CI | GitHub Actions `lint` (ruff + format check + mypy) + `test` (pytest with Neon branch isolation), test gated on lint |
| Container | Multi-stage Dockerfile (frontend-builder + runtime), non-root `app` user, uv 0.11.7 pinned, wget for HEALTHCHECK |
| Deploy | Railway project `welcoming-vision` → service `backend` auto-deploys on push; Postgres add-on wired via `${{Postgres.DATABASE_URL}}`; DSN normalizer handles `postgresql://` → `postgresql+psycopg://` |
| Startup | `scripts/start.sh` — `alembic upgrade head && uvicorn` with `set -euo pipefail` |

**Live URL:** https://backend-production-7af8.up.railway.app

## Verification

- **91/91 pytest pass** (unit + integration with Neon branching)
- **CI green** on latest commits
- **Railway /health** returns `{"status":"ok","env":"production","db":"ok"}` consistently
- **Manual smoke test end-to-end:** stub login → `/auth/me` returns ADMIN → `/admin/users` renders HTML with CSRF tokens → approve PENDING user flips role to ANALYST → self-deactivate returns 422 → logout clears session → `/auth/me` returns 401

## Bugs caught during M1 (all fixed, all committed)

1. `FxRate` D15 immutability — added ORM before_flush hook + Postgres trigger + partial unique index (belt-and-suspenders)
2. Alembic JSONB single-quote injection in seed — fixed with dollar-quoting (`$json$...$json$::jsonb`)
3. `users.name` nullable (Google may not return display name first call)
4. `/health` was leaking DB error text — moved to log only
5. `clear_session_cookie` missing `secure` flag
6. `except Exception` → `except BadData` in session decode
7. `hash(email)` → SHA-256 truncated (process-salted hash was reversible)
8. Raw f-string URL construction → `urllib.parse.urlencode`
9. `oauth_state` cookie missing `secure`
10. `httpx.ConnectError`/`TimeoutException` not caught in token exchange
11. Header mutation after `RedirectResponse` construction → restructured
12. `html.escape()` missing on pending page email interpolation
13. Admin `approve_user` didn't set `is_active=True`
14. `id=uuid.uuid4()` duplicated with `UUIDPrimaryKeyMixin` default
15. Jinja autoescape made explicit via `select_autoescape(["html"])`
16. Self-deactivation guard added
17. Idempotency guards on deactivate/reactivate (no-op skips audit write)
18. `session.query` → `session.scalars(select(...))` (SQLA 2.0 style)
19. `try/finally` in `RequestIDMiddleware` so contextvars clear on exceptions
20. CSRF middleware parse wrong content-types → branch on Content-Type, fall back to `X-CSRF-Token` header for multipart
21. `configure_logging()` called before `get_logger()` (was after, cached unconfigured chain)
22. `/health` CSRF exempt prefix broadened → exact match
23. `httpx` was dev-only dep but imported at runtime in `auth.py`
24. CI `uv sync --frozen` didn't install `[dev]` → added `--extra dev`
25. Ruff — 4 stale `noqa` + unused imports
26. Mypy — 9 missing annotations in `middleware.py`, `auth.py`, `audit_log.py`, `events.py`
27. CI `APP_ENV=test` not in Literal allowlist → `APP_ENV=development`
28. Docker runtime stage `OSError: Readme file does not exist` → copy README.md before `uv sync`
29. Railway runtime `uv run` can't mkdir `/home/app/.cache/uv` (non-root user has no home) → drop `uv run`, call binaries directly via `scripts/start.sh`
30. Railway Postgres DSN is `postgresql://` (routes to missing psycopg2) → `_normalize_dsn` rewrites to `postgresql+psycopg://` in both `session.py` and `alembic/env.py`
31. `scripts/` not copied in Dockerfile → added `COPY scripts/ ./scripts/`

## Known side-items (deferred, not M1 blockers)

- **Stub login overwrites `user.name`** — `_upsert_user` in `auth.py` updates name on every login. In prod with Google this is fine (Google always sends real name). In dev with `AUTH_PROVIDER=stub`, "Stub User" clobbers real names. Only matters if you log into prod with stub — which you shouldn't.
- **Railway orphan Postgres services** — two spawned during the `railway add` dance before the pty trick worked. Visible in dashboard, need manual delete (GraphQL mutation rejected by account token scope).
- **Settings docstring references missing `app/core/startup.py`** — comment says "Startup guard raises if stub is selected in production — see app/core/startup.py" but that module doesn't exist. Either build the guard or fix the comment. Low priority until a real human OAuth login is needed.
- **CI actions still on Node 20** — GitHub deprecation warning for `astral-sh/setup-uv@v5.4.0` and `actions/checkout@v4`. Harmless until June 2026.
- **SPF/DKIM for Resend/SendGrid on `emb.global`** — must be requested from EMB IT now (M6 blocker, 2+ month lead time is not unheard of).

## Handoff to M2 — parsers + wireframes

Spec §14 designates M2 as the de-risk milestone. Priority order:

1. **Parser tests against the 3 real sample files in `backend/tests/fixtures/sample_files/`.** These are production data — do not copy them anywhere else. Parsers must stage unparseable rows as `PARSE_ERROR`, never drop.
2. **Tally parser** (GrpBills): forward-fill party name across rows, skip sub-total rows, reconcile against grand total. Do NOT use Tally's `overdue_days` or `due_on` for our ageing — spec §15.
3. **Xero parser**: skip `"Total "` rows, preserve `xero_metadata` column, sniff `as_of_date` from header.
4. **Credit period parser**: drop UAE `Amount` column (D20), reject duplicates, 0-day credit is valid.
5. **Wireframes**: HTML+Tailwind static or ASCII layouts in `/wireframes/` for **S1 (Upload), S2 (Staging), D1 (Dashboard)** at minimum. Tejaswa reviews before any React implementation starts — this gate blocks M4.

**Branch strategy:** open a PR `feature/m1-foundations → main` first so M1 is safe on `main`, then branch `feature/m2-parsers-wireframes` off `main`.

**Dispatch pattern:** same subagent-driven-development workflow used for M1 (dispatch → spec review → code quality review → fix loop). Sonnet for mechanical parser work, Opus only if a parser hits an ambiguity that requires judgment on the sample data.

## Reference

- Spec: `02_HANDOFF_SPEC.md` (locked decisions in §2, do-not list in §15)
- M1 design: `docs/superpowers/specs/2026-04-16-m1-foundations-design.md`
- M1 plan: `docs/superpowers/plans/2026-04-16-m1-foundations.md`
- ADRs: `docs/adr/0001-*.md`, `0002-use-neon-for-postgres.md`
- Guardrails: `CLAUDE.md`
