# Claude Code — Project Guardrails

## Source of truth
- `02_HANDOFF_SPEC.md` (or `docs/02_HANDOFF_SPEC.md`) is the locked spec. Treat as law.
- If the spec and code disagree, the spec wins. Fix the code, don't amend the spec without asking the user.

## Before every session
1. Re-read `02_HANDOFF_SPEC.md` section 2 (locked decisions) and section 15 (do-not list).
2. Check `docs/adr/` for any architecture decisions recorded since spec.
3. Check current milestone in `PROGRESS.md` (authoritative) or ask the user.

## Quick commands
- Backend deps: `uv sync`
- Backend dev: `uv run uvicorn app.main:app --reload --app-dir backend/src` (→ :8000)
- Migrations: `uv run alembic -c backend/alembic.ini upgrade head` (new: `… revision -m "name"`)
- Backend tests (fast, no DB): `uv run pytest backend/tests/unit -q -m "not slow"`
- Backend tests (full, Neon branch per session): `uv run pytest backend/tests/ -q -p no:randomly`
- Lint / type / format: `uv run ruff check .`, `uv run mypy backend/src`, `uv run pre-commit run --all-files`
- Frontend dev: `cd frontend && npm run dev` (→ :5173, proxies /auth, /snapshots, /config, … to :8000)
- Frontend check: `cd frontend && npm run typecheck && npm run lint && npm run test && npm run build`

## Repo map
- `backend/src/app/` — `main.py`, `config.py`, `api/routes/` (auth, admin, config, snapshots, dashboard, exceptions, follow_ups, invoices, parties), `services/` (ageing, snapshot, staging, alias_resolver, source_detect, partition_check, publish, discard, config, dashboard, exception, fx_conversion, reconciliation), `parsers/` (tally, xero, credit_period, common), `db/models/` (14 models), `schemas/` (13 pydantic), `core/`, `emails/`, `templates/`
- `backend/tests/` — `unit/`, `integration/`, `fixtures/sample_files/` (real client xlsx, gitignored), `conftest.py` (Neon branch-per-session fixture), `neon_branch.py`
- `backend/alembic/versions/` — 8 migrations (`0001_initial` → `0008_q3_q4_2026_partitions`)
- `frontend/src/` — `pages/` (16: Login, Pending, NotFound, S1–S6, D1–D3, A2–A6), `components/ui/` (9 primitives), `hooks/`, `lib/`, `api/`, `types/`, `App.tsx` (router tree)
- `docs/` — `02_HANDOFF_SPEC.md` (symlink), `adr/` (4 ADRs), `runbook.md`, `superpowers/plans/` (5 plans + M1 spec)

## Docs to consult (in this order when re-orienting)
1. `PROGRESS.md` — canonical current state (milestones shipped, known gaps, next steps).
2. `LOCAL_SETUP.md` — end-to-end smoke-test walkthrough + 13-item prod-readiness checklist.
3. `02_HANDOFF_SPEC.md` §2 (locked decisions D1–D23), §13 (consequences), §15 (do-not list).
4. `docs/adr/` — architecture decisions post-spec (currently 4: Neon override, Tally/Xero grand-total reconciliation).
5. `docs/runbook.md` — ops (partition creation SQL, etc.).
6. `wireframes/*.html` + `wireframes/README.md` — visual truth (approved 2026-04-18). Compare `frontend/src/pages/XPage.tsx` to `wireframes/X*.html` on UI questions.

## Never do these (from spec §15 + project hygiene)
- Invent credit period defaults. Entity defaults come from admin config (D8).
- Auto-backfill historical data (D14).
- Allow FX rate mutation after creation (D15).
- Silently skip unparseable rows — stage as PARSE_ERROR.
- Use Tally's overdue_days or due_on for ageing calc.
- Let CFO or PENDING roles publish/edit anything.
- Persist UAE credit period `Amount` column (D20).
- Send CFO emails before user explicitly flips rule to active.
- Deploy anywhere other than Railway (D21). Postgres is on Neon per ADR-0002; Railway hosts the FastAPI app.
- Commit `.env`, secrets, OAuth credentials, SMTP keys.
- Run scheduler on >1 replica without Postgres job store locks.
- Use `datetime.today()` for ageing — always use snapshot's as_of_date.

## Always do these
- Pin FX lookup by invoice_date, never upload_date or today.
- Log to structlog. No print statements.
- Every mutation writes an audit_log row with before/after JSON.
- Every parser error stages the row as PARSE_ERROR, never drops.
- Every publish is gated on all four: zero unmapped parties above 70% confidence, all warnings acknowledged, zero unresolved PARSE_ERROR rows, correct role.
- Every API endpoint: type-hinted request/response with pydantic v2, RBAC enforced via dependency.
- Every DB migration: reversible, reviewed, has a seed/rollback note if destructive.
- Every sample-file parser change: re-run parser tests against the 3 files in `backend/tests/fixtures/sample_files/`.
- Use `uv` for Python dep management. Never `pip install` directly.
- Use `npm` for frontend (not yarn or pnpm — keep consistent).

## Operational gotchas
- **Neon branch per pytest session.** `conftest.py` creates a branch on session start; tests 422 on branch create if stale branches accumulate (Neon free-tier quota). See `LOCAL_SETUP.md § Production readiness` for the cleanup curl loop.
- **`invoice_snapshots` is partitioned by `as_of_date` quarterly.** 2026-Q1 through Q4 partitions exist (migration `0008_q3_q4_2026_partitions`). Uploads outside Jan–Dec 2026 return 422 `MISSING_PARTITION`. Next deadline: create 2027-Q1 via `docs/runbook.md § Partitioning invoice_snapshots` before **2026-12-25**.
- **CSRF.** Backend sets `csrf_token` cookie; frontend mirrors it to `X-CSRF-Token` header on every mutating request. 403 on POST/PATCH/DELETE → check cookie is present.
- **Tally has no embedded as_of_date.** Upload form must supply one; Xero sniffs from row 2.
- **Prior-publish reconciliation gate (§13 #6).** A second publish against the same entity returns 422 `PRIOR_SNAPSHOT_UNRECONCILED` if the prior snapshot isn't reconciled via `/admin/reconciliation`.
- **§13 #6 has a source_hint blind spot (open).** The prior-snapshot lookup at `backend/src/app/services/publish_service.py:511` does not filter by source_hint. Once a CP master is published at as_of=D, the next TALLY/XERO publish at as_of>D will 422 `PRIOR_SNAPSHOT_UNRECONCILED` because the CP snapshot is picked as "prior" (and CP snapshots never have a `ReconciliationEntry`). Fix: add `Snapshot.source_hint.in_(("TALLY","XERO"))` filter. Task chip spawned 2026-04-19.
- **Dashboard resolver filters invoice-source snapshots only.** `dashboard_service._resolve_snapshot` must only pick snapshots with `source_hint IN ('TALLY','XERO')` — CP publishes write zero `invoice_snapshots` rows (ADR-0005) so selecting one returns all-zero aggregates. Enforced via `_INVOICE_SOURCE_HINTS` constant + regression test `test_dashboard_latest_skips_credit_period_snapshot`.
- **Credit-days is static at publish time.** `_resolve_credit_days` runs once per invoice during publish and the result is persisted on the `invoices` row (`credit_days_applied`, `credit_days_source`, `due_date`). Subsequent changes to `credit_period_config` do NOT retroactively apply. To refresh after a CP-master change: re-publish the snapshot (spec-aligned, but hits the §13 #6 gate above) or run a targeted backfill that also recomputes `invoice_snapshots.overdue_days` + `bucket`. There is no admin endpoint for this yet.
- **Upload order matters for clean canonicals.** Upload the CP master for a period **before** the TALLY/XERO snapshot. CP publish does exact-name lookup on `(entity_id, name)` (ADR-0005 D1 — rejected fuzzy on publish) — uploading TALLY first then CP produces orphan CP canonicals whenever the CP spelling drifts from the invoice-side canonical. Known long-term fix is Phase 3 (fuzzy-match at CP publish + staging-review for CP); until then, ordering is the mitigation.
- **Canonical merge is raw SQL, no endpoint.** When a CP-side canonical and an invoice-side canonical refer to the same client under different spellings, there is no admin-UI merge. Approach: move `party_aliases.canonical_id` and `credit_period_config.canonical_id` from CP-side → invoice-side (so `invoices.canonical_id` stays put), delete the CP-side `parties_canonical` row, write `audit_log` entry with `action='CANONICAL_MERGE'`. All in one transaction. See the `audit_log` for `action IN ('CANONICAL_MERGE','CREDIT_DAYS_BACKFILL')` on 2026-04-19 for a working template.
- **`AUTH_PROVIDER=stub|google` toggle.** Local default is `stub` — auto-creates an ADMIN user on first hit. Production cutover flips to `google`; until the stub-in-prod startup guard lands, confirm the flip by hand.
## Ops log (selective)

Durable notes on one-off data operations. Full detail is in `audit_log`.

- **2026-04-19 — CP coverage rescue (IND).** First CP master publish landed on 2026-04-19; exposed three issues:
  1. Dashboard all-zero bug — CP snapshot shadowed TALLY in `_resolve_snapshot`. Fixed with `source_hint` filter (see Operational gotchas).
  2. Canonical drift — 26 of 113 IND OPEN-invoice canonicals had no CP coverage. Fuzzy-match (rapidfuzz token_sort_ratio) surfaced 6 HIGH / 8 LOW / 12 NONE. 3 pure-typo HIGH cases merged (VY LABS, Godrej Properties, SentiWiz — CP-side → invoice-side). 3 HIGH confirmed distinct (Yatra Online Limited ≠ Yatra Online Pvt Limited; `-Old` suffix convention = distinct legal entity: Roppen, VRIDHI). Post-merge coverage: 90/113.
  3. Credit-days frozen at DEFAULT — all 291 IND OPEN invoices published 2026-04-16 used entity default (30d) because publish predated the CP master. Targeted backfill ran: 255 invoices moved to `credit_days_source='CONFIG'`, `invoice_snapshots.bucket + overdue_days` recomputed per `app.services.ageing`. Net ageing shift: 90_PLUS 153→159, NOT_DUE 61→50 (CP terms are tighter than 30d for most clients). 36 invoices remain on DEFAULT across 23 uncovered canonicals (3 distinct, 8 LOW false-positives, 12 not in CP master — need CFO to add rows or accept entity default).

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
- **Prefer Sonnet for execution.** Keep the main Opus session for planning, review, and synthesis; delegate implementation / test-writing / codebase spelunking to Sonnet subagents via the Agent tool with `model: "sonnet"`. Saves tokens and clears the main context window. Opus stays only for work that genuinely needs it (architecture decisions, ambiguous spec questions, tricky debugging).

## Parallel guardrail file
`AGENTS.md` at repo root is the Codex mirror of this file — keep the two in lockstep when either is edited. Currently untracked per `git status`; commit decision pending (see `LOCAL_SETUP.md` item 1).
