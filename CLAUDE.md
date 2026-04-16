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
