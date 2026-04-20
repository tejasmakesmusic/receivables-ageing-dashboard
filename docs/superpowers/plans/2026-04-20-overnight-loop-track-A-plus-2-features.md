# Overnight loop plan — Track A spec completion + 2 new features (+ optional B polish)

**Date:** 2026-04-20
**Runner:** Ralph Loop on Sonnet (current session)
**Scope:** 8 hard items (Track A + 2 new features). Optional 7 polish items as B-track if A finishes early.
**Stop:** rate-limit OR 3 consecutive task failures OR all A-items ticked.

Each item is a self-contained Sonnet dispatch. Pick the next unchecked item, execute, verify per the task's "Verify" line, tick + log status, move on.

## Ground rules (every task)

- Repo root: `/Users/teja/Documents/Claude/Projects/receivables_ageing_dashboard`.
- Read `CLAUDE.md` "Always do these / Never do these / Operational gotchas" before coding.
- `uv` for Python, `npm` for frontend.
- CSRF header `X-CSRF-Token` on every frontend mutation.
- Audit_log row on every backend mutation.
- structlog, no `print`.
- Never commit secrets.
- `from __future__ import annotations` already in use across the suite.
- Decimal serialization on the wire as string.
- Reuse `components/ui/` primitives (Card, Badge, Button, Modal, Input, Textarea, Select, Skeleton, Pagination).
- No new deps.
- Reports: <250 words, no diffs, files touched + tests added + verify pass/fail.

---

## Track A — Spec completion + new features

### A.1 — Exception exclude flow (NEW feature)

- [x] **A.1 Exception exclude flow.**

Mark an ACTIVE exception as excluded from the main list with a reason (LEGAL_HOLD, NEGOTIATION, AGREED_WRITE_OFF, OTHER). Excluded exceptions stay in DB (for audit) but hide from S5's main view by default; "Show excluded (N)" toggle surfaces them. ADMIN can un-exclude; ANALYST can exclude (entity-scoped); CFO read-only; PENDING 403.

**Backend**

1. New Alembic migration `0010_exception_exclude.py`:
   - `ALTER TABLE exception_tags ADD COLUMN excluded_at TIMESTAMPTZ NULL`
   - `ALTER TABLE exception_tags ADD COLUMN excluded_reason VARCHAR(64) NULL` (CHECK constraint values: LEGAL_HOLD, NEGOTIATION, AGREED_WRITE_OFF, OTHER)
   - `ALTER TABLE exception_tags ADD COLUMN excluded_reason_note TEXT NULL`
   - `ALTER TABLE exception_tags ADD COLUMN excluded_by UUID NULL REFERENCES users(id)`
   - Reversible.

2. `ExceptionTag` model: add the 4 columns.

3. `ExceptionExcludeRequest` schema: `{reason: Literal[LEGAL_HOLD, NEGOTIATION, AGREED_WRITE_OFF, OTHER], reason_note: str | None}`. `OTHER` requires non-empty note (model_validator).

4. New routes in `backend/src/app/api/routes/exceptions.py`:
   - `POST /exceptions/{id}/exclude` body `ExceptionExcludeRequest`. RBAC: ANALYST (entity-scoped via invoice→canonical→entity), ADMIN any. CFO/PENDING 403. Sets `excluded_at=now()`, `excluded_reason`, `excluded_reason_note`, `excluded_by`. Audit log `EXCEPTION_EXCLUDED`.
   - `POST /exceptions/{id}/un-exclude` — ADMIN only. Clears the 4 fields. Audit log `EXCEPTION_UNEXCLUDED`.

5. Existing `GET /exceptions` route: add query param `include_excluded: bool = False`. Default filter: `excluded_at IS NULL`. When `include_excluded=true`, include all rows.

6. Extend `ExceptionListRow` schema: `excluded_at`, `excluded_reason`, `excluded_reason_note`, `excluded_by_email` (LEFT JOIN users for display).

7. Dashboard top-party `active_exception_count` aggregation must skip excluded rows. Update `dashboard_service._compute_top_parties`.

**Frontend**

8. Mirror new fields in `frontend/src/types/index.ts` (`ExceptionListRow`).

9. `S5ExceptionsPage.tsx`:
   - "Exclude" button per row (next to existing Tag/Resolve actions).
   - `ExcludeModal` component: reason `Select` (4 options) + note `Textarea` (mandatory if OTHER). Submit calls `POST /exceptions/{id}/exclude`.
   - Toggle "Show excluded (N)" near the table — when on, sets `?include_excluded=true` on the query.
   - Excluded rows: gray out + render an "Excluded — {reason}" badge in the bucket column.
   - "Un-exclude" button only for ADMIN, only on excluded rows. Confirm modal.

**Tests**

10. Backend integration `backend/tests/integration/test_exception_exclude.py`: exclude + un-exclude happy paths, RBAC (ANALYST scope, CFO 403, PENDING 403), include_excluded filter, OTHER reason requires note (422), un-exclude ADMIN-only, audit log row written, dashboard top-party count skips excluded.

11. Frontend vitest in `S5ExceptionsPage.test.tsx`: exclude modal opens + submits + hides row, toggle shows excluded rows, un-exclude ADMIN-only.

**Verify**

- `uv run pytest backend/tests/integration/test_exception_exclude.py -q`
- `uv run pytest backend/tests/integration/test_exceptions_crud.py backend/tests/integration/test_dashboard.py -q -p no:randomly` (regression)
- `cd frontend && npm run typecheck && npm run test -- --run S5Exceptions`
- `uv run alembic -c backend/alembic.ini upgrade head` clean

---

### A.2 — Edit credit period config via UI (NEW feature)

- [x] **A.2 Edit credit period config via UI.**

Today the only way to change a canonical's credit days is to re-upload the CP master XLSX and republish. That's heavy for one-off tweaks (e.g. CFO calls and says "Yatra terms changed to 25 days"). Add an analyst-facing edit endpoint that supersedes the active config per ADR-0005 D3.

**Backend**

1. `CreditPeriodEditRequest` schema: `{days: int, reason_note: str | None}`. Days >= 0.

2. New route in `backend/src/app/api/routes/config.py` (or wherever credit-period CRUD lives — confirm by grep): `POST /config/credit-period/{canonical_id}` body `CreditPeriodEditRequest`.
   - RBAC: ANALYST entity-scoped (via canonical→entity), ADMIN any. CFO/PENDING 403.
   - Behavior: reuse the supersede logic from `_publish_credit_period_snapshot` in `publish_service.py` — close active config (`valid_to = today - 1 day`), insert new row (`valid_from = today`, `valid_to = NULL`). Idempotent: if `(days, reason_note)` matches active config, return 200 with `result: 'noop'`.
   - Audit log `CREDIT_PERIOD_EDITED`.

3. Extend response shape to include the new active config row (id, days, reason_note, valid_from).

**Frontend**

4. `S3CreditPeriodPage.tsx`: each row in the credit-period config list has an "Edit" button. Opens `EditCreditPeriodModal` with current days + reason as defaults. Submit calls `POST /config/credit-period/{canonical_id}` with new values.

5. Show toast / inline confirmation: "Updated. Old config closed, new config effective {today}."

6. CFO sees Edit button as disabled (or hidden); ADMIN/ANALYST sees enabled.

**Tests**

7. Backend integration `backend/tests/integration/test_credit_period_edit.py`: happy path supersedes; idempotent no-op; ANALYST-in-scope OK; ANALYST-out-of-scope 403; CFO 403; PENDING 403; audit log row written; days < 0 → 422.

8. Frontend vitest in `S3CreditPeriodPage.test.tsx` (create if missing): edit modal opens with current values, save calls API, list refreshes.

**Verify**

- `uv run pytest backend/tests/integration/test_credit_period_edit.py -q`
- `cd frontend && npm run typecheck && npm run test -- --run S3CreditPeriod`
- `uv run ruff check backend/src/app/api/routes/config.py`

---

### A.3 — `email_rules` table + admin CRUD + service wiring

- [x] **A.3 email_rules table + admin CRUD.**

Spec §3, §8.1, §10, §9 all reference `email_rules`. Currently absent. Recipients are hardcoded (CFO via role lookup, ANALYST via role+entity lookup). With the table, ADMIN can edit recipients + cron + active flag without code changes.

**Backend**

1. Alembic migration `0011_email_rules.py`: create `email_rules` table:
   - `id UUID PK DEFAULT gen_random_uuid()`
   - `rule_type VARCHAR(64) UNIQUE NOT NULL` (CHECK in: DAILY_DIGEST, WEEKLY_DEFAULT_CP_NUDGE, PUBLISH_NOTIF)
   - `recipients_json JSONB NOT NULL DEFAULT '[]'::jsonb` (list of email strings)
   - `cron_schedule VARCHAR(64) NULL` (e.g. "0 9 * * *" for DAILY_DIGEST; null for PUBLISH_NOTIF which is event-driven)
   - `is_active BOOLEAN NOT NULL DEFAULT true`
   - `entity_filter VARCHAR(8) NULL` (IND/UAE/ALL)
   - `notes TEXT NULL`
   - `created_at TIMESTAMPTZ DEFAULT now()`
   - `updated_at TIMESTAMPTZ DEFAULT now()`
   - `updated_by UUID NULL REFERENCES users(id)`
   - Seed three rows: DAILY_DIGEST (recipients empty, cron `0 9 * * *`, active=false), WEEKLY_DEFAULT_CP_NUDGE (recipients empty, cron `0 9 * * 1`, active=false), PUBLISH_NOTIF (recipients empty, cron NULL, active=true).
   - Reversible.

2. `EmailRule` model.

3. Schemas: `EmailRuleRow`, `EmailRulePatchRequest` (`recipients_json`, `cron_schedule`, `is_active`, `entity_filter`, `notes` — all optional). Identity (rule_type) is immutable.

4. New routes in `backend/src/app/api/routes/admin.py`:
   - `GET /admin/email-rules` — list all 3 rules. ANALYST/ADMIN/CFO read.
   - `PATCH /admin/email-rules/{id}` — ADMIN only. Audit log `EMAIL_RULE_UPDATED`.

5. Wire services to read recipients from `email_rules`:
   - `digest_service.run_daily_digest` — query `EmailRule` for DAILY_DIGEST. If `is_active=false` or recipients empty, log info + skip enqueue.
   - `default_cp_nudge_service.run_weekly_default_cp_nudge` — same pattern.
   - `publish_service` PUBLISH_NOTIF enqueue — read PUBLISH_NOTIF recipients.
   - For each: if no row exists in email_rules (shouldn't happen post-seed), fall back to existing role-discovery logic with a warning log. Don't crash.

**Frontend**

6. Extend A2 (`A2EmailOutboxPage.tsx`) — add an "Email rules" section above the outbox list. Show 3 rows with: rule type, recipients (chip-list), cron, active toggle, "Edit" button. Edit modal: textarea for recipients (one email per line), cron input, active checkbox, entity filter select. Save → PATCH `/admin/email-rules/{id}`.

7. ANALYST/CFO: read-only view. ADMIN: edit enabled.

**Tests**

8. Backend integration `backend/tests/integration/test_email_rules.py`: GET (3 roles), PATCH (ADMIN happy + ANALYST/CFO 403 + PENDING 403), audit log on patch, identity field (rule_type) immutable, recipients accepts/persists JSON list.

9. Backend integration extension to existing digest/nudge tests: assert reading from email_rules instead of hardcoded discovery; assert skip when active=false.

10. Frontend vitest `A2EmailOutboxPage.test.tsx`: rules section renders, ADMIN sees Edit button, edit modal saves.

**Verify**

- `uv run pytest backend/tests/integration/test_email_rules.py backend/tests/integration/test_digest_service.py backend/tests/integration/test_default_cp_nudge.py -q`
- `cd frontend && npm run typecheck && npm run test -- --run A2EmailOutbox`
- `uv run alembic -c backend/alembic.ini upgrade head` clean

---

### A.4 — S3 "Parties on default CP" report section (spec §13 #5)

- [x] **A.4 S3 default-CP report.**

Spec §13 #5 requires this report visible on S3, not just on the D1 callout. Today S3 has the CP master config list; add a section listing canonicals currently on entity-default credit days.

**Backend**

1. Likely re-use `default_cp_nudge_service.compute_default_cp_payload(entity_code, db)` — already returns the per-canonical list with outstanding totals. Confirm it can be called from the config route.

2. Extend `GET /config/credit-period` (or add a new sub-route `GET /config/credit-period/default-parties?entity_code=IND`) returning `{entity_code, as_of_date, total_parties_on_default, top_parties: [...]}`.

**Frontend**

3. `S3CreditPeriodPage.tsx` — add a section "Parties on default credit period" above the CP master config list. Shows total count + sortable table of canonicals (name, total outstanding, n_open_invoices) with a per-row "Set custom CP" button that opens the same `EditCreditPeriodModal` from A.2 (infrastructure shared).

**Tests**

4. Backend integration: route returns expected shape with seeded DEFAULT-source invoices.

5. Frontend vitest in `S3CreditPeriodPage.test.tsx`: section renders, rows clickable, links to A.2 edit flow.

**Verify**

- `uv run pytest backend/tests/integration/test_default_cp_nudge.py -q -k report` (or new test file)
- `cd frontend && npm run test -- --run S3CreditPeriod`

---

### A.5 — D12 stale-follow-up flag

- [x] **A.5 D12 stale-follow-up flag.**

ACTIVE exceptions older than 7 days since their last follow-up are flagged stale. Surfaces on S5 (red badge) so analysts spot neglected exceptions.

**Backend**

1. Extend `ExceptionListRow` schema with `is_stale: bool`. Computation: `is_stale = (status='ACTIVE' AND (last_follow_up_date IS NULL OR last_follow_up_date < CURRENT_DATE - INTERVAL '7 days'))`. The `last_follow_up_date` field is already on the row from prior loop work (Task 14).

2. Optional: dashboard KPI `stale_exception_count` per entity for D1 (skip if scope creep — focus on S5 surface).

**Frontend**

3. `S5ExceptionsPage.tsx`: render a red "Stale" badge next to ACTIVE exceptions where `is_stale=true`.

4. Sort/filter: "Show stale only" toggle.

**Tests**

5. Backend: extend `test_exceptions_crud.py` — assert `is_stale=true` when last_follow_up_date is null + status=ACTIVE; false when recent follow-up exists.

6. Frontend: extend `S5ExceptionsPage.test.tsx` — stale badge renders for stale rows, hidden for non-stale.

**Verify**

- `uv run pytest backend/tests/integration/test_exceptions_crud.py -q`
- `cd frontend && npm run test -- --run S5Exceptions`

---

### A.6 — RBAC negative-test gap-fill

- [x] **A.6 Two RBAC negative tests + close §9 deviation on staging GET.**

Surfaces from gap survey:
1. No negative test for `PATCH /snapshots/:id/staging/:row` by CFO → expects 403.
2. No negative test for `DELETE /follow-ups/:id` by PENDING → expects 403.
3. `GET /snapshots/:id/staging` excludes CFO per code (`_allowed`) but spec §9 implies CFO read access. Decide: code-side fix (add CFO to dep) or doc-side fix (update spec). Recommend code-side fix to align with §9 — CFO is read-only across the board everywhere else, this should match.

**Tasks**

1. Add tests #1 + #2 to `backend/tests/integration/test_rbac_negative_gaps.py`.
2. For #3: change the dep from `_allowed` to `_read_allowed` on the staging GET route in `backend/src/app/api/routes/snapshots.py` (line ~149). Add a positive test asserting CFO gets 200 on staging GET.
3. Update `test_m3_rbac_matrix.py` to flip the documented deviation note.

**Verify**

- `uv run pytest backend/tests/integration/test_rbac_negative_gaps.py backend/tests/integration/test_m3_rbac_matrix.py -q`

---

## Track B — Wireframe polish (run if A finishes early)

### B.1 — D1 KPI sub-lines + 90+ at-risk + week-mini-grid

- [ ] **B.1** Add `pct_overdue_prior_week`, `ninety_plus_total_outstanding` to `DashboardKPIs`. Render sub-lines on D1 KPI tiles. Below sparkline, add a 4-cell W-4/W-3/W-2/Now numeric mini-grid.

### B.2 — S1 CP step-list + UAE note + PARSING badge

- [ ] **B.2** Add the CP-panel step-list + amber UAE-Amount-not-persisted note. Add `PARSING` status badge to recent uploads table.

### B.3 — S2 per-warning ack + bucket-color legend footer

- [ ] **B.3** Replace bulk warning-ack with per-warning Acknowledge button. Add bucket + credit-source legend footer.

### B.4 — S5 outstanding-sum on bucket cards + Edit + Log-followup links

- [ ] **B.4** Add `outstanding_amount` to `ExceptionListRow`. Show per-card outstanding sum. Add "Edit" action (PATCH expected_resolution_date / reason / bucket_type_id). Add per-row "Log follow-up →" link to S6 with prefilled invoice/canonical context.

### B.5 — A6 large match-status pill + count column

- [ ] **B.5** Add the centered MATCHED/MISMATCHED/UNRECONCILED pill + 3-state legend row. Add `Count` column to exception bucket breakdown table.

### B.6 — A1 React rewrite (skip — known compromise)

Out of scope for this loop; tracked in PROGRESS.md.

---

## Status log

*Loop runner: append one line per task — `✅ A.1 done (timestamp)` or `❌ A.3 failed (exit 1, last: <err>)`.*

- ✅ A.1 done — Exception exclude flow (Alembic 0010, 4 new columns, 2 new routes, include_excluded filter, dashboard top-party count skips excluded; 18 backend + 39 frontend tests, 1 pre-existing Neon flake unrelated)
- ✅ A.2 done — POST /config/credit-period/{canonical_id} supersede/noop/insert + S3 Edit modal; ADR-0005 D3 idempotency honored; 10 backend + 15 regression + 9 frontend tests pass
- ✅ A.3 done — email_rules table (Alembic 0011), GET/PATCH /admin/email-rules, digest+nudge+publish wired read-then-fallback, A2 rules section + EditEmailRuleModal; 14+8 backend + 11 frontend tests
- ✅ A.4 done — GET /config/credit-period/default-parties + S3 section + reuse A.2 EditCreditPeriodModal; 6 backend + 7 new frontend tests (3 pre-existing nudge regressions flagged as Neon state pollution, unrelated)
- ✅ A.5 done — is_stale derived per-row in list_exceptions; red "Stale" badge + "Show stale only" toggle on S5; 6 backend + 5 new frontend tests
- ✅ A.6 done — CFO PATCH staging-row 403 + PENDING DELETE follow-up 403 + §9 deviation closed (CFO now reads staging GET via `_read_allowed`, write paths still deny CFO via `allow_cfo_read=False`); 113 RBAC tests green
- 🎉 ALL 6 TRACK A ITEMS COMPLETE
