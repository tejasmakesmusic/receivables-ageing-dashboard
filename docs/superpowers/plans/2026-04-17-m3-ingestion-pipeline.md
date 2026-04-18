# M3 — Ingestion Pipeline — Implementation Plan

**Date:** 2026-04-17
**Branch:** `feature/m3-ingestion` (off `main` at `9bf95bb`)
**Scope:** spec §3 (data model — staging/published tables), §4 (parsers already shipped in M2), §5 (state machine), §6 (ageing — shipped in M2), §7 (FX lookup), §10 (API contract), §11 (non-functional), §12 (testing), §13 consequences (#1 auto-resolve on SETTLED, #2 material-change >5%, #3 FX pin by invoice_date, #7 PENDING-role gate), §15 (do-not list).
**Dispatch:** subagent-driven-development, Sonnet implementers, spec + code quality review per task. Opus only for judgement calls on alias matching tuning.

---

## Exit criteria (spec §12 + §5 state machine)

- [ ] Alembic migration `0003_m3_ingestion` adds: `snapshots`, `invoices`, `invoice_snapshots`, `parties_canonical`, `party_aliases`, `credit_period_config`, `exception_bucket_types` (seeded with D9 set), plus all §3 indexes. Reversible. `invoice_snapshots` partitioned by `as_of_date` quarterly from day 1.
- [ ] `POST /snapshots` accepts multipart XLSX, rejects duplicate sha256, dispatches to correct parser by `source_hint` (auto-detected or form-supplied), creates snapshot row in `STAGED`, persists staged invoices/credit-periods. Enforces `invoice_date ≤ as_of_date` per row (Tally); Xero's sniffed `as_of_date` takes precedence when present, else form input.
- [ ] `GET /snapshots/:id/staging` returns staged invoices with alias resolution state (exact/fuzzy/unmapped) + fuzzy suggestions ranked by RapidFuzz token_sort_ratio.
- [ ] `PATCH /snapshots/:id/staging/:row` accepts alias resolution (`canonical_id` or create-new) and credit-days manual override; records `credit_days_source = MANUAL` when overridden.
- [ ] `POST /snapshots/:id/publish` gates: zero unmapped parties above 70% confidence, all validation warnings acknowledged, zero PARSE_ERROR rows unresolved, caller role permits publish for this entity (ANALYST scoped to own entity, ADMIN any). Upserts into `invoices` on `(entity_id, canonical_party_id, invoice_ref)`. Marks invoices absent from this snapshot as SETTLED. Writes `invoice_snapshots` rows with computed `overdue_days` + `bucket` (via M2 `compute_ageing`). Flags `>5% amount change` on active exceptions (§13 #2). Cascades exception tags to `AUTO_RESOLVED` on SETTLED transition (§13 #1). Writes `audit_log` entry. Emits structured "publish notif" event (SMTP deferred to M6 — log the event for now).
- [ ] `POST /snapshots/:id/discard` transitions `STAGED → DISCARDED`, requires ANALYST/ADMIN role.
- [ ] `GET/POST /config/credit-period` CRUD for ADMIN; `GET` for ANALYST. `valid_from`/`valid_to` versioning per spec §3.
- [ ] `GET/POST/PATCH/DELETE /config/aliases` CRUD for ADMIN/ANALYST.
- [ ] RBAC: every endpoint has a negative-role test (CFO cannot publish/edit; PENDING 403s; ANALYST cannot publish other entity).
- [ ] 3-snapshot upsert integration test (insert → update → SETTLED transition) passes.
- [ ] Audit log rows written on publish, discard, staging PATCH, config CRUD. All with `before_json`/`after_json`.
- [ ] All new endpoints have pydantic v2 request/response schemas + OpenAPI docs.

---

## Open decisions (resolve before dispatching)

1. **`PUBLISH_NOTIF` email during M3.** Spec §5 says publish fires it. SMTP integration is M6. **Default:** emit a structured log event (`event=publish_notif_queued`) and write a row to an `email_outbox` table that M6 drains. Don't block publish on SMTP.
2. **FX rate module.** Spec §7 says consolidated view uses AED→INR pinned by `invoice_date`. `fx_rates` table already exists from M1. M3 must populate `invoice_snapshots.outstanding_amount` — question: do we store native-currency only in `invoice_snapshots` and let the dashboard convert at read-time (M4), or pre-compute INR-equivalent on publish? **Default:** native-currency storage only. Dashboard handles FX at read-time (M4). Keeps snapshots reproducible even if rates change.
3. **Publish-gate "warnings acknowledged" state.** Spec §5 mentions it but doesn't specify where acknowledgement is persisted. **Default:** add `snapshots.warnings_acknowledged_json` JSONB — list of acknowledged warning codes + who + when. Missing ack → publish blocks.
4. **Alias master seeding.** Empty on first upload. First-upload flow must let analyst create canonical parties + aliases inline during staging review. **Default:** `PATCH /snapshots/:id/staging/:row` with `action=create_canonical` creates the canonical + alias in one transaction.

Flag these in the first commit's ADR / plan commentary.

---

## Task order (subagent-driven-development, sequential)

### Task 1 — DB schema + Alembic migration `0003_m3_ingestion`

**Scope:** all §3 tables not already created in M1, indexes, partition, immutability triggers where required (none new — FX is M1).

**Files:**
- `backend/alembic/versions/0003_m3_ingestion.py` — reversible migration.
- `backend/src/app/db/models/snapshot.py`
- `backend/src/app/db/models/invoice.py` (and `invoice_snapshot.py`)
- `backend/src/app/db/models/party.py` (parties_canonical + party_aliases)
- `backend/src/app/db/models/credit_period_config.py`
- `backend/src/app/db/models/exception_bucket_type.py` — with D9 seed in a data migration.
- Tests: per-model unit tests (introspection + constraint checks); migration round-trip test.

**Spec refs:** §3 DDL (canonical), D9 (seeded exception buckets), §13 #7 (PENDING role gates — no DB impact here but ripples into API), D15 (fx_rates already immutable from M1).

**Do-not:** mutate fx_rates schema (D15 locked); touch any M1 model files except to add relationships where genuinely needed (imports only).

### Task 2 — Snapshot upload endpoint + state machine entry

**Scope:**
- `POST /snapshots` multipart upload handler.
- Snapshot lifecycle service: `SnapshotService.create(file_bytes, entity_id, as_of_date, source_hint, actor)` → opens snapshot in `STAGED`, runs parser, stores staged rows.
- Duplicate-sha256 rejection (409).
- Dispatch logic: auto-detect source from filename + sheet names, honor form override.
- Write audit_log entry.
- RBAC: ANALYST (entity-scoped) or ADMIN.

**Files:**
- `backend/src/app/api/routes/snapshots.py`
- `backend/src/app/services/snapshot.py`
- `backend/src/app/schemas/snapshot.py` — pydantic v2 request/response.
- Tests: success path each source type, duplicate file rejection, wrong-entity rejection, PENDING/CFO role rejection, parser-error propagation.

**Depends on:** Task 1.

### Task 3 — Alias master + fuzzy matching

**Scope:**
- `AliasResolver` service: exact → fuzzy token_sort_ratio → thresholded buckets per D11.
- Snapshot-staging integration: on upload, resolve each staged invoice against alias master, attach `resolution_state` (`EXACT` / `FUZZY_HIGH` / `FUZZY_LOW` / `UNMAPPED`) + top-3 suggestions.
- Tests: synthetic alias corpus; boundary tests at exactly 70/89/90% ratio; multi-alias same canonical; performance test (10k aliases, sub-second resolution).

**Files:**
- `backend/src/app/services/alias_resolver.py`
- `backend/src/app/schemas/staging.py` — resolution state.
- Tests: `backend/tests/unit/services/test_alias_resolver.py`, integration in staging flow.

**Depends on:** Task 1 (parties_canonical + party_aliases).

### Task 4 — Staging review API

**Scope:**
- `GET /snapshots/:id/staging` — paginated staged invoices + credit-periods + resolution state + fuzzy suggestions + PARSE_ERROR rows separately.
- `PATCH /snapshots/:id/staging/:row` — accepted actions:
  - `resolve_alias`: attach existing canonical, optionally create new alias row.
  - `create_canonical`: create new canonical + alias in one tx.
  - `override_credit_days`: sets `credit_days_applied` + `credit_days_source=MANUAL`.
  - `dismiss_parse_error`: analyst acknowledges a PARSE_ERROR row won't be published (lands in discard-on-publish).
- Audit_log on every PATCH.

**Files:**
- Staging routes under `backend/src/app/api/routes/snapshots.py` (same module).
- `backend/src/app/services/staging.py`.

**Depends on:** Task 3.

### Task 5 — Publish endpoint with upsert + SETTLED cascade + ageing compute

**Scope:**
- `POST /snapshots/:id/publish` — 5 guards (4 from spec §5 + PARSE_ERROR resolution).
- Upsert on `(entity_id, canonical_party_id, invoice_ref)`: INSERT if new, UPDATE status/raw_row_json/xero_metadata if existing.
- Mark absent invoices `SETTLED`, stamp `settled_snapshot_id`.
- Cascade exception_tags `ACTIVE → AUTO_RESOLVED` on SETTLED (§13 #1). Material-change flag on active exceptions with >5% amount delta (§13 #2) — emit a new exception_tag audit event, don't silently mutate.
- For each published invoice, compute and insert `invoice_snapshots` row: `(snapshot_id, invoice_id, as_of_date, outstanding_amount=amount native, overdue_days, bucket)` via M2 `compute_ageing`.
- Write audit_log `action=snapshot.publish`.
- Emit `publish_notif` event to `email_outbox` table (M6 drains).
- Transition snapshot `STAGED → PUBLISHED`.

**Files:**
- `backend/src/app/services/publish.py`
- `backend/src/app/db/models/email_outbox.py` (add, with Alembic migration `0004_m3_email_outbox` — small sibling migration).
- Tests: 3-snapshot upsert integration, PARSE_ERROR gate, unmapped-party gate, warning-ack gate, role gate, SETTLED transition, AUTO_RESOLVED cascade, material-change flag, idempotent republish rejection.

**Depends on:** Tasks 2, 3, 4.

### Task 6 — Discard + credit-period config API + alias config API

**Scope:**
- `POST /snapshots/:id/discard` — STAGED → DISCARDED, role-gated.
- `GET/POST /config/credit-period` — list / create versioned rows. Close prior open row on new insert (`valid_to = new.valid_from - 1 day`). ADMIN write, ANALYST read.
- `GET/POST/PATCH/DELETE /config/aliases` — ADMIN/ANALYST CRUD.
- All mutations write audit_log.

**Files:**
- `backend/src/app/api/routes/config.py`
- `backend/src/app/services/credit_period.py` (versioning logic).

**Depends on:** Task 1.

### Task 7 — RBAC integration test suite + 3-snapshot end-to-end test

**Scope:**
- RBAC: every endpoint × every role negative test.
- E2E: upload snapshot #1 → resolve aliases → publish. Upload snapshot #2 (same file, one invoice settled) → publish → verify SETTLED transition + AUTO_RESOLVED cascade. Upload snapshot #3 with amount change on active-exception invoice → verify material-change flag.

**Depends on:** Tasks 1–6.

---

## Out of scope for M3 (explicit)

- Dashboard endpoints (`/dashboard`, `/parties/:id`, `/invoices/:id`) → M4.
- Exception tag CRUD endpoints (`POST /invoices/:id/exceptions` etc.) → M5. Auto-resolution cascade on SETTLED happens in M3 but via direct DB update, not via the exception API.
- Follow-up endpoints → M5.
- FX conversion at read time → M4.
- Daily digest cron → M6. Publish notification email delivery → M6. M3 writes to `email_outbox` only.
- Reconciliation (A6) endpoint → M6.
- React frontend → M4+.

---

## Dispatch order

1. Task 1 (schema) — Sonnet. Spec + quality review.
2. Task 2 (upload) — Sonnet.
3. Task 3 (alias resolver) — Sonnet; bump to Opus if thresholds need tuning against real data.
4. Task 4 (staging API) — Sonnet.
5. Task 5 (publish) — Sonnet, heavier review cycle.
6. Task 6 (discard + config CRUD) — Sonnet.
7. Task 7 (RBAC + E2E) — Sonnet.
8. Final branch review → finishing-a-development-branch → PR.

---

## Reference

- Spec: `02_HANDOFF_SPEC.md` §3, §5, §7, §10, §11, §12, §13, §15
- M2 parsers: `backend/src/app/parsers/{common,tally,xero,credit_period}.py`
- M2 ageing calc: `backend/src/app/services/ageing.py`
- M2 handoff ADRs: `docs/adr/0003-tally-grand-total-reconciliation.md`, `docs/adr/0004-xero-grand-total-reconciliation.md`
- Guardrails: `CLAUDE.md`
