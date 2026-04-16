# Receivables Ageing Dashboard

Internal EMB Global platform for AR ageing across India (Tally) + UAE
(Xero) entities.

**Owner:** Tejaswa Sharma — `tejaswa.sharma@emb.global`
**Status (2026-04-16):** Scaffold complete (Milestone 0). Feature work
starts on **"start Milestone 1 feature work"** signal.

---

## For Claude Code / any implementer (start here)

1. [`CLAUDE.md`](./CLAUDE.md) — guardrails (read EVERY session)
2. [`02_HANDOFF_SPEC.md`](./02_HANDOFF_SPEC.md) — canonical spec. Treat as law.
3. [`01_brainstorm_screens_and_features.md`](./01_brainstorm_screens_and_features.md) — rationale / consequence analysis.
4. [`docs/adr/`](./docs/adr/) — architecture decision records (post-spec).

**Rule:** If a decision isn't covered in the handoff spec (§2 D1–D23 or §13
consequences), STOP and ask Tejaswa. Do not invent defaults.

---

## Repo layout

```
backend/                FastAPI + SQLAlchemy + Alembic
  src/app/              application package (main, config, db, api, services, parsers, core, emails)
  tests/                pytest — unit / integration / fixtures/sample_files (real client data, gitignored)
  alembic/              migrations (versions empty until M1)
frontend/               React 18 + Vite + TS + Tailwind + shadcn/ui + TanStack Query + React Router
wireframes/             HTML+Tailwind mockups (generated in M2, reviewed before M4 React build)
docs/
  adr/                  architecture decision records
  runbook.md            ops runbook (populated incrementally)
  02_HANDOFF_SPEC.md    symlink to root spec
CLAUDE.md               guardrails for every Claude Code session
Dockerfile              multi-stage: frontend-builder → runtime (Railway)
docker-compose.yml      local dev (postgres + backend + frontend)
railway.json            Railway build + deploy config
pyproject.toml          Python deps + ruff / black / mypy / pytest config
.pre-commit-config.yaml ruff + black + mypy + prettier
.env.example            all required env vars (copy to .env for local dev)
```

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.12 | managed by `uv` |
| `uv` | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node | 22 LTS | `nvm install 22 && nvm use 22` |
| npm | bundled | — |
| Docker | 24+ | Docker Desktop (Mac) |
| Postgres | 16 | via Docker Compose |

Don't substitute — the spec (D21 + bootstrap prompt) pins these.

---

## First-time setup

```bash
# 1. Python deps
uv sync

# 2. Start Postgres
docker compose up -d postgres

# 3. Copy env + fill in Google OAuth + email keys
cp .env.example .env
# edit .env (SESSION_SECRET at minimum; OAuth + email secrets before M1 deploy)

# 4. Run migrations (none in M0 — creates alembic_version table only)
uv run alembic -c backend/alembic.ini upgrade head

# 5. Install pre-commit hooks
uv run pre-commit install

# 6. Start backend
uv run uvicorn app.main:app --reload --app-dir backend/src
# → http://localhost:8000/health

# 7. Start frontend (in another terminal)
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

---

## Verifying the scaffold

```bash
# Backend
curl localhost:8000/health
# → {"status":"ok","env":"development"}

uv run pytest                        # >0 tests pass (smoke test on /health)
uv run ruff check .                  # clean
uv run mypy backend/src              # clean
uv run pre-commit run --all-files    # clean

# Frontend
cd frontend && npm run typecheck     # clean
npm run build                        # produces frontend/dist/
```

---

## Sample test files (real client data — DO NOT commit)

Drop these into [`backend/tests/fixtures/sample_files/`](./backend/tests/fixtures/sample_files/):

| File | Purpose | Used by |
|---|---|---|
| `GrpBills.xlsx` | Tally India — sheet `Sundry Debtors` | M2 Tally parser tests |
| `MANTARAV_Aged_Receivables_Detail.xlsx` | Xero UAE — MANTARAV entity | M2 Xero parser tests |
| `Credit Period for Accounts - India & UAE.xlsx` | Credit period master (2 sheets) | M2 credit-period parser tests |

The `.gitignore` at repo root excludes `*.xlsx` from that path. See
[`backend/tests/fixtures/sample_files/README.md`](./backend/tests/fixtures/sample_files/README.md) for the red-flag protocol if one ever shows up in `git status`.

---

## Milestone status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Repo scaffold + CLAUDE.md + Dockerfile + Railway config | ✅ complete (2026-04-16) |
| M1 | Foundations: DB schema, entities, fx_rates, users, Google SSO, PENDING flow, deploy skeleton to Railway | ⏳ awaits signal |
| M2 | Parsers (Tally/Xero/CreditPeriod) + Ageing calc + Wireframes (HTML+Tailwind) | — |
| M3 | Ingestion pipeline: upload → stage → alias match → publish | — |
| M4 | Dashboard + drill-downs (D1/D2/D3) — gated on M2 wireframe sign-off | — |
| M5 | Exceptions + follow-ups (S5/S6) | — |
| M6 | Admin screens + daily digest + reconciliation (A1–A6) | — |
| M7 | Hardening + UAT | — |
| M8 | Production cutover (DNS, Railway Pro, backups, first live snapshot) | — |

---

## Env vars to populate before Railway deploy (M1 day 3)

From [`.env.example`](./.env.example):

- `DATABASE_URL` — Railway sets automatically when you add the Postgres plugin
- `SESSION_SECRET` — generate: `python -c "import secrets; print(secrets.token_urlsafe(64))"`
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — from Google Cloud Console, authorized redirect URI = `https://<railway-domain>/auth/google/callback`
- `GOOGLE_OAUTH_ALLOWED_DOMAIN=emb.global` (default, keep)
- `EMAIL_PROVIDER=resend` or `sendgrid` (D22 — decide at first deploy)
- `RESEND_API_KEY` OR `SENDGRID_API_KEY`
- `SMTP_FROM_ADDRESS` — discuss subdomain with IT (consequence #14)

**DNS prerequisite (M1 starts):** get EMB IT to add SPF + DKIM for
`emb.global` for the chosen email provider. Propagation has lead time.

---

## Deployment target

**Railway** (spec D21). Single service — FastAPI serves API + built React
bundle via `StaticFiles`. Config in [`railway.json`](./railway.json).
Pro plan required (free tier sleeps — breaks the 9 AM IST digest, see
consequence #9).

No other hosting. Don't deploy elsewhere without an ADR.
