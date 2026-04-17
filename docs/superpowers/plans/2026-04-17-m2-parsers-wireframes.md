# M2 — Parsers + Wireframes — Implementation Plan

**Date:** 2026-04-17
**Branch:** `feature/m2-parsers-wireframes` (off `main` after M1 PR merge)
**Scope:** Spec §4 (parsers), §6 (ageing), §9 (wireframes S1/S2/D1/S5/A6), §12 (tests), §15 (do-not list)
**Dispatch:** subagent-driven-development workflow. Sonnet for all implementer tasks; Opus only if a parser hits a real-data ambiguity.

---

## Exit criteria (spec §14 M2 + §12)

- [ ] Tally parser passes against `GrpBills.xlsx`: party forward-fill, sub-totals skipped, grand total reconciles (₹1 tolerance).
- [ ] Xero parser passes against `MANTARAV_Aged_Receivables_Detail.xlsx`: `"Total "` rows skipped, `xero_metadata` preserved, `as_of_date` sniffed from header, AED 1 reconcile tolerance.
- [ ] Credit Period parser passes against `Credit Period for Accounts - India & UAE.xlsx`: UAE `Amount` column dropped (D20), duplicate names fail whole upload, 0-day credit valid, empty rows skipped.
- [ ] Ageing calc boundary tests green at 0, 30, 31, 60, 61, 90, 91 days overdue; uses `as_of_date` not `datetime.today()`.
- [ ] No parser silently drops an invoice row — unparseable rows carry `PARSE_ERROR` status with row index + reason.
- [ ] Wireframes for S1 (Upload), S2 (Staging), D1 (Dashboard), S5 (Exception Manager), A6 (Reconciliation) in `/wireframes/` as HTML+Tailwind, ready for Tejaswa sign-off.
- [ ] All new tests pass; lint/type clean; CI green.

---

## Open decisions (resolve before dispatching)

1. **Branch strategy.** Handoff doc recommends: PR `feature/m1-foundations → main`, merge, then branch `feature/m2-parsers-wireframes` off main. Alternative: stack m2 on top of m1 (faster but intertwined). Default: PR + merge M1 first, then branch m2 off main.
2. **Sample-file fixtures in CI.** Files are git-ignored real client data. Options: (a) parser tests `pytest.skip` if files missing so CI passes cleanly; (b) synthesize sanitized fixtures with same shape for CI. Default: (a) for M2; revisit if CI gaps bite.

---

## Task order (one implementer subagent per task, sequential)

### Task 1 — Parser infrastructure + common dataclasses

**Scope:**
- `backend/src/app/parsers/common.py` — pydantic v2 models (`StagedInvoice`, `StagedCreditPeriod`, `ParseError`, `ParseResult`), `ParseStatus` enum (`OK`, `PARSE_ERROR`), and small shared helpers: SHA-256, row-coercion. File name `common.py` matches the existing scaffold note in `parsers/__init__.py`.
- `backend/src/app/parsers/__init__.py` exports the public names.
- Tests: `backend/tests/unit/parsers/test_common.py`.

**Spec refs:** §4.4 (common parser behavior), §3 (staging/invoices columns that `StagedInvoice` maps onto — `source_currency`, `invoice_date`, `invoice_ref`, `amount`, `party_name_raw`, `raw_row_json`, `row_index`).

**Do-not:** persist anything to DB; parsers are pure functions. No `datetime.today()`.

### Task 2 — Tally parser (GrpBills.xlsx)

**Scope:**
- `backend/src/app/parsers/tally.py` — `parse_tally_grpbills(file_bytes: bytes) -> ParseResult`.
- Tests: `backend/tests/unit/parsers/test_tally.py` with real fixture, `pytest.skip` if absent.

**Spec §4.1 rules, verbatim:**
1. Skip rows 0–4. Normalize headers to `date, ref_no, party_name, opening_amount, pending_amount, due_on, overdue_days`.
2. Party header row (party_name populated, date/ref empty) → forward-fill `party_name`.
3. Invoice row (date+ref populated) → emit `StagedInvoice(invoice_date=date, invoice_ref=ref_no, amount=pending_amount, party_name_raw=forward-filled, source_currency="INR")`.
4. Sub-total row (date+ref empty, amounts populated) → SKIP. Validate sub-total ≈ sum of that party's rows; log warning if mismatch > ₹1.
5. Drop `due_on` and `overdue_days` from emitted fields. Stash full raw row in `raw_row_json`. Keep `opening_amount` in `raw_row_json` only.
6. Source currency = `INR`.
7. Validate: extracted total matches Tally grand total row; fail whole parse if off by more than ₹1.
8. `as_of_date` ≥ every `invoice_date`.

**Do-not (spec §15):** use `overdue_days` or `due_on` for anything besides round-trip raw storage. Silently drop any row — unparseable rows must be emitted with `status=PARSE_ERROR`.

### Task 3 — Xero parser (Aged Receivables Detail)

**Scope:**
- `backend/src/app/parsers/xero.py` — `parse_xero_aged_receivables(file_bytes: bytes) -> ParseResult`.
- Tests: `backend/tests/unit/parsers/test_xero.py`.

**Spec §4.2 rules:**
1. Sniff `"As at DD Month YYYY"` from row 2 → `as_of_date` on `ParseResult`.
2. Skip rows 0–5; normalize headers from row 5.
3. Party header rows (Contact Account Number populated, others empty) → forward-fill.
4. Rows where party name starts with literal `"Total "` → SKIP (sub/grand totals).
5. Invoice row: emit with `invoice_date`, `invoice_ref` (from `Reference`), `amount` (from `Total`). Outstanding Tax stored but unused for ageing.
6. `xero_metadata` JSONB payload on each `StagedInvoice`: `invoice_seen, invoice_sent, project_id, service_month, primary_person, email`.
7. Source currency = `AED`.
8. Validate: grand total matches sum of invoice rows, tolerance AED 1.
9. Warn if `"Invoice Seen" == "Not seen"` count > 20% of rows.

**Do-not:** use Xero's due date for ageing; it's informational only.

### Task 4 — Credit Period parser (India + UAE sheets)

**Scope:**
- `backend/src/app/parsers/credit_period.py` — `parse_credit_period_master(file_bytes: bytes) -> ParseResult`.
- Tests: `backend/tests/unit/parsers/test_credit_period.py`.

**Spec §4.3 rules:**
1. India sheet columns: `Client Name, Credit Period`. Emit `StagedCreditPeriod(entity_code="IND", name, credit_days)`.
2. UAE sheet columns: `Client Name, Credit Period, Reason for extended Credit Period, Amount`. Emit `StagedCreditPeriod(entity_code="UAE", name, credit_days, reason_note)`. **Drop `Amount` column entirely — do not persist, do not keep in `raw_row_json` either** (D20).
3. `credit_days = 0` is valid.
4. Empty `Client Name` → SKIP.
5. Duplicate client names within a sheet → FAIL the parse with the full list of duplicates in errors.

**Do-not (D20, §15):** keep the UAE Amount column anywhere downstream.

### Task 5 — Ageing calc module

**Scope:**
- `backend/src/app/services/ageing.py` — `compute_ageing(invoice_date: date, credit_days: int, as_of_date: date) -> AgeingResult` (pydantic model: `due_date`, `overdue_days`, `bucket` literal).
- Tests: `backend/tests/unit/services/test_ageing.py` with boundary cases at exactly 0, 30, 31, 60, 61, 90, 91 days overdue, plus `as_of_date < due_date` (NOT_DUE), plus a `freezegun` test proving the function never calls `datetime.today()` (use a past `as_of_date` and assert result doesn't change with frozen time).

**Spec §6 formula (verbatim):**
```
due_date = invoice_date + timedelta(days=credit_days)
overdue_days = (as_of_date - due_date).days
if overdue_days < 0:     bucket = "NOT_DUE"
elif overdue_days <= 30: bucket = "0_30"
elif overdue_days <= 60: bucket = "31_60"
elif overdue_days <= 90: bucket = "61_90"
else:                    bucket = "90_PLUS"
```

**Do-not:** touch `datetime.today()` or `datetime.now()`.

### Task 6 — Wireframes (S1, S2, D1, S5, A6)

**Scope:**
- `/wireframes/S1-upload.html` — Upload screen (file picker, entity selector, recent snapshots table).
- `/wireframes/S2-staging.html` — Staging review grid (party resolution queue, unmapped highlight, publish gate status).
- `/wireframes/D1-dashboard.html` — Main dashboard (KPI cards, ageing bucket bars, entity toggle IND/UAE/Consolidated).
- `/wireframes/S5-exceptions.html` — Exception manager (tag types from D9, follow-up trail).
- `/wireframes/A6-reconciliation.html` — Reconciliation view (Dashboard AR + exceptions − Tally/Xero AR delta).
- `/wireframes/README.md` — navigation index + "this is a static mockup, not a live app" banner.

**Format (D23):** HTML + Tailwind via CDN, no JS framework, no build step. Include role indicator (ANALYST/CFO/ADMIN) in nav so permission visibility is obvious.

**Spec refs:** §9 for screen list, §13 consequence #16 (wireframe gate blocks M4), §2 D23.

**Do-not:** start React anything. No JS logic beyond minimal `<details>`/tab toggles if needed.

---

## Out of scope for M2 (explicitly deferred)

- Upload endpoint, snapshots table, staging table inserts → M3.
- Alias master, fuzzy matching → M3.
- FX conversion → M4 (module may be stubbed for unit tests only).
- Dashboard React implementation → M4, gated on wireframe sign-off.

---

## Dispatch order

1. Task 1 (infra) — Sonnet, spec review, code quality review, commit.
2. Task 2 (Tally) — Sonnet, reviews, commit.
3. Task 3 (Xero) — Sonnet, reviews, commit.
4. Task 4 (Credit Period) — Sonnet, reviews, commit.
5. Task 5 (Ageing) — Sonnet, reviews, commit.
6. Task 6 (Wireframes) — Sonnet, reviews, commit. (Opus if visual judgment calls come up.)
7. Final branch review → finishing-a-development-branch → PR.

---

## Reference

- Spec: `02_HANDOFF_SPEC.md` §2, §4, §6, §9, §12, §13, §14, §15
- M1 handoff: `docs/superpowers/plans/2026-04-17-m1-complete-handoff.md`
- Guardrails: `CLAUDE.md`
