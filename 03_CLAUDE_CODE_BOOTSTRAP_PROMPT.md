# Claude Code Bootstrap Prompt

Copy the block below into Claude Code's first message. It sets up the repo, tooling, conventions, and a persistent guardrails file (`CLAUDE.md`) so every subsequent Claude Code session behaves consistently.

---

## The prompt (copy from here)

```
You are bootstrapping a new internal project for EMB Global called "Receivables Ageing Dashboard".

## Read these first (in order)
1. ./README.md
2. ./02_HANDOFF_SPEC.md  — this is the canonical spec. Treat it as law.
3. ./01_brainstorm_screens_and_features.md  — rationale, read for context only.

All design decisions (D1–D23) are already locked. Do not re-debate them. If any decision is missing or ambiguous, STOP and ask the user (Tejaswa Sharma, tejaswa.sharma@emb.global). Do not invent defaults.

## Your job in this first session
Scaffold the repo and establish working conventions. Do NOT start feature implementation (parsers, screens, API endpoints). Implementation begins only after I review the scaffold and explicitly say "start Milestone 1 feature work."

### Scaffold these exact directories
```
receivables-ageing-dashboard/
├── CLAUDE.md                     # Guardrails for all future Claude Code sessions (see below)
├── README.md                     # Project overview, setup steps, how to run
├── .gitignore                    # Python, Node, IDE, env, Railway
├── .env.example                  # All required env vars with placeholder values
├── .pre-commit-config.yaml       # ruff, black, mypy, prettier
├── docker-compose.yml            # Local dev: Postgres + backend
├── Dockerfile                    # Railway-ready (multi-stage: build frontend → serve via FastAPI)
├── railway.json                  # Railway config (build + start commands)
├── pyproject.toml                # Python deps + tool config (ruff, black, mypy, pytest)
├── backend/
│   ├── src/
│   │   └── app/
│   │       ├── __init__.py
│   │       ├── main.py           # FastAPI app entrypoint (health check only for now)
│   │       ├── config.py         # pydantic-settings, reads from env
│   │       ├── db/
│   │       │   ├── __init__.py
│   │       │   ├── session.py    # SQLAlchemy engine + session factory
│   │       │   └── base.py       # Declarative base
│   │       ├── models/           # SQLAlchemy models — EMPTY for now, one file per table later
│   │       ├── schemas/          # Pydantic schemas — EMPTY for now
│   │       ├── api/
│   │       │   ├── __init__.py
│   │       │   ├── deps.py       # Dependency injection (db session, current user)
│   │       │   └── routes/       # EMPTY — routes added per milestone
│   │       ├── services/         # Business logic (parsers, ageing calc, upsert) — EMPTY
│   │       ├── parsers/          # Tally, Xero, CreditPeriod parsers — EMPTY
│   │       ├── core/
│   │       │   ├── auth.py       # Google SSO + session mgmt
│   │       │   ├── rbac.py       # Role middleware
│   │       │   ├── logging.py    # structlog config
│   │       │   └── scheduler.py  # APScheduler setup
│   │       └── emails/           # Resend/SendGrid client + templates
│   ├── tests/
│   │   ├── conftest.py           # pytest fixtures (db, client, factories)
│   │   ├── unit/
│   │   ├── integration/
│   │   └── fixtures/
│   │       └── sample_files/     # COPY the 3 sample files here from /sessions/upbeat-peaceful-ramanujan/mnt/uploads/
│   └── alembic/
│       ├── env.py
│       ├── script.py.mako
│       └── versions/             # Migrations — EMPTY initially; M1 creates the first
├── frontend/
│   ├── package.json              # React 18, Vite, Tailwind, React Router, TanStack Query, shadcn/ui
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx               # Router with placeholder routes for all screens from spec §9
│       ├── api/                  # API client (fetch wrapper, auth interceptor)
│       ├── components/
│       │   └── ui/               # shadcn/ui components
│       ├── pages/                # One file per screen code (S1, S2, D1, ...) — stubs only
│       ├── hooks/
│       ├── lib/                  # utils, formatters (INR/AED, dates in IST)
│       └── types/                # Shared TypeScript types
├── wireframes/                   # HTML+Tailwind static mockups — POPULATED in M2
│   └── README.md                 # "Wireframes generated in Milestone 2"
└── docs/
    ├── adr/                      # Architecture Decision Records
    │   └── 0001-record-architecture-decisions.md
    ├── 02_HANDOFF_SPEC.md        # Symlink or copy from parent
    └── runbook.md                # Empty stub for now
```

### Tooling choices (lock these, do not substitute)
- Python 3.12, package manager: **uv** (faster than pip, cleaner than poetry)
- Dep spec in `pyproject.toml`. Lock file: `uv.lock`. Do NOT use requirements.txt.
- Backend: FastAPI, SQLAlchemy 2.x, Alembic, pydantic v2, pydantic-settings, structlog, APScheduler, slowapi, authlib (for Google OAuth), resend OR sendgrid SDK, rapidfuzz, openpyxl, pandas (only for xlsx parsing)
- Testing: pytest, pytest-asyncio, httpx, factory-boy, freezegun (for ageing/date tests)
- Linting/formatting: ruff (replaces flake8/isort), black, mypy strict, pre-commit
- Frontend: React 18 + Vite + TypeScript, Tailwind, shadcn/ui, React Router v6, TanStack Query, react-hook-form, zod (shared validation with backend schemas via codegen later)
- Testing (FE): vitest, @testing-library/react, playwright for E2E (phase 2+)

### Create CLAUDE.md with these contents
This file is read by every Claude Code session. Write it to enforce guardrails:

```markdown
# Claude Code — Project Guardrails

## Source of truth
- `02_HANDOFF_SPEC.md` (or `docs/02_HANDOFF_SPEC.md`) is the locked spec. Treat as law.
- If the spec and code disagree, the spec wins. Fix the code, don't amend the spec without asking the user.

## Before every session
1. Re-read `02_HANDOFF_SPEC.md` section 2 (locked decisions) and section 15 (do-not list).
2. Check `docs/adr/` for any architecture decisions recorded since spec.
3. Check current milestone in README.md or ask the user.

## Never do these (from spec §15 + project hygiene)
- Invent credit period defaults. Entity defaults come from admin config (D8).
- Auto-backfill historical data (D14).
- Allow FX rate mutation after creation (D15).
- Silently skip unparseable rows — stage as PARSE_ERROR.
- Use Tally's overdue_days or due_on for ageing calc.
- Let CFO or PENDING roles publish/edit anything.
- Persist UAE credit period `Amount` column (D20).
- Send CFO emails before user explicitly flips rule to active.
- Deploy anywhere other than Railway (D21).
- Start M4 (dashboard React) before M2 wireframes signed off (D23).
- Commit `.env`, secrets, OAuth credentials, SMTP keys.
- Run scheduler on >1 replica without Postgres job store locks.
- Use `datetime.today()` for ageing — always use snapshot's as_of_date.

## Always do these
- Pin FX lookup by invoice_date, never upload_date or today.
- Log to structlog. No print statements.
- Every mutation writes an audit_log row with before/after JSON.
- Every parser error stages the row as PARSE_ERROR, never drops.
- Every publish is gated: zero unmapped parties above 70% confidence + all validation acknowledged + correct role.
- Every API endpoint: type-hinted request/response with pydantic v2, RBAC enforced via dependency.
- Every DB migration: reversible, reviewed, has a seed/rollback note if destructive.
- Every sample-file parser change: re-run parser tests against the 3 files in `backend/tests/fixtures/sample_files/`.
- Use `uv` for Python dep management. Never `pip install` directly.
- Use `npm` for frontend (not yarn or pnpm — keep consistent).

## Commit style
- Conventional commits: `feat(parsers): add Tally GrpBills parser`, `fix(ageing): correct boundary at 0 days`, `chore(deps): bump pandas`.
- Every commit must pass pre-commit hooks (ruff, black, mypy, prettier).
- PRs (if using GitHub): linked to milestone, with checklist from spec §12 for that milestone.

## Testing discipline
- Parsers: tests against actual sample files are non-negotiable (spec §12).
- Ageing calc: boundary tests at 0, 30, 31, 60, 61, 90, 91 days.
- FX: test rate-boundary, missing rate, multi-period invoice.
- RBAC: every endpoint has a negative-role test.
- Ingestion upsert: 3-snapshot test (insert → update → settle).
- No skipped or xfail tests without an issue link.

## When to stop and ask the user
- A decision is not in `02_HANDOFF_SPEC.md` section 2 or the consequences list.
- The spec contradicts itself (flag the contradiction verbatim).
- A dependency has a CVE or major breaking change.
- You need to commit a secret or credential.
- Deployment on Railway hits an issue that changes architecture (e.g., needs Redis where spec didn't).

## Data handling
- Never print raw invoice data in logs. Hash or redact party names in non-debug logs.
- Sample files in `backend/tests/fixtures/sample_files/` are real client data — do not commit copies outside this path, do not exfiltrate.

## User context
- User is Tejaswa Sharma (Rev Ops / Data Analytics at EMB Global).
- Prefers structured outputs: tables, schemas, numbered steps.
- Peer-level direct tone. No filler. Push back when something looks off.
- Assume SQL + Python + Excel fluency. Don't explain basics.
- Flag downstream consequences of any design deviation.
```

### Additional setup
1. Initialize git repo. First commit: "chore: initial scaffold".
2. Set up pre-commit hooks and run them against the scaffold.
3. Write a minimal `backend/src/app/main.py` FastAPI app with one endpoint: `GET /health` → `{"status": "ok"}`.
4. Write a minimal `frontend/src/App.tsx` with one route: `/` → `<div>Receivables Ageing Dashboard — Phase 1</div>`.
5. Set up docker-compose so `docker compose up` launches Postgres + backend locally.
6. Write `alembic/env.py` wired to the same DB URL as the app.
7. Create the first ADR (`docs/adr/0001-record-architecture-decisions.md`) stating we use ADRs + summary of stack choices.
8. Copy the 3 sample files from `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/` into `backend/tests/fixtures/sample_files/` and add them to `.gitignore` (real client data — do NOT commit). Note in README.md how to re-fetch them.
9. Verify everything by running:
   - `uv sync` — deps install
   - `docker compose up -d postgres` — DB up
   - `uv run alembic upgrade head` — migrations (empty initially)
   - `uv run uvicorn app.main:app --reload` — backend starts
   - `curl localhost:8000/health` — returns ok
   - `cd frontend && npm install && npm run dev` — frontend starts
   - `uv run pytest` — 0 tests pass (not 0 tests run)
   - `uv run ruff check . && uv run mypy backend/src` — no errors
10. Update README.md with exact setup steps, tested commands above, and milestone status table.

### Output at end of session
- Summary of what was scaffolded
- Exact `uv sync` + `docker compose up` + `npm install` commands tested and passing
- List of env vars in `.env.example` that I need to populate before first Railway deploy
- Any issues or open questions you hit

### Stop conditions
- Do NOT write parsers, models, screens, or API routes beyond the `/health` stub.
- Do NOT deploy to Railway yet (deploy happens in M1, day 3).
- Do NOT create the DB schema (Milestone 1 task).
- If you finish the scaffold, STOP and wait for "start Milestone 1 feature work" before proceeding.
```

---

## Why this prompt works

1. **Anchors to the spec.** First action = read the handoff. No drift possible.
2. **Writes `CLAUDE.md`.** Every future Claude Code session in this repo inherits the guardrails automatically without re-prompting.
3. **Scaffold-only scope.** Prevents Claude Code from enthusiastically implementing features before wireframes / DB design are reviewed.
4. **Concrete directory structure.** No room for Claude to improvise layout, which makes handoffs between sessions deterministic.
5. **Tooling locked.** `uv` + `ruff` + `pydantic v2` + `shadcn/ui` — modern, fast, opinionated. Reduces bike-shedding.
6. **Hard stop conditions.** The "do not write parsers yet" and "wait for start Milestone 1" are explicit gates.
7. **Verifies with commands.** Final session ends with green lights, not "should work".

## How to use

1. Open Claude Code in an empty directory (e.g., `~/projects/receivables-ageing-dashboard/`).
2. Copy `02_HANDOFF_SPEC.md`, `01_brainstorm_screens_and_features.md`, and `README.md` from your Cowork folder into the new directory first (Claude Code can read them locally).
3. Paste the prompt above.
4. Review what it scaffolds. When satisfied, tell Claude Code: `start Milestone 1 feature work`.

## After first session

In every subsequent Claude Code session, your opening prompt can be as short as:

```
Continue on Milestone N. Start by re-reading CLAUDE.md and 02_HANDOFF_SPEC.md sections 2 and 15.
```

Because `CLAUDE.md` exists in the repo, Claude Code will pick up all guardrails without you repeating them.
