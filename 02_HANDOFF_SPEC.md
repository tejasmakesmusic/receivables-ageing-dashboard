# Receivables Ageing Dashboard — Handoff Spec

**Project:** Internal EMB Global receivables ageing platform
**Owner:** Tejaswa Sharma (`tejaswa.sharma@emb.global`)
**Handoff to:** Claude Code (implementation)
**Date locked:** 2026-04-16
**Status:** Design frozen. Ready for implementation.

> **Read order for implementation:**
> 1. This doc (`02_HANDOFF_SPEC.md`) — locked decisions + spec
> 2. `01_brainstorm_screens_and_features.md` — full rationale + consequence analysis
> 3. Sample files in `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/` — ground truth for parser tests
>
> **Golden rule:** all ambiguity was resolved during design. If you hit a decision not covered here, STOP and ask Tejaswa. Do not invent defaults.

---

## 1. Scope

### In scope (Phase 1)
- India entity (Tally export: `GrpBills.xlsx`, sheet `Sundry Debtors`)
- UAE entity — MANTARAV DIGITAL INFORMATION TECHNOLOGY CONSULTANCY — SOLE PROPRIETORSHIP L.L.C. (Xero export: `Aged Receivables Detail`)
- Credit period master (Excel upload, 2 sheets: `India`, `UAE`)
- Ageing with custom due-date calc (using EMB credit period, NOT Tally's due date)
- Exception bucketing (persisting across snapshots)
- Party alias master (fuzzy matching)
- Follow-up activity log (structured)
- Email triggers: Daily CFO digest (9 AM IST) + Publish notification
- Roles: Analyst, CFO/Mgmt, Admin (+ transient PENDING)
- Google Workspace SSO (`@emb.global` domain-restricted)
- Reconciliation guardrail view (Dashboard AR vs Tally/Xero AR)

### Out of scope (Phase 2+)
- Additional entities beyond India/UAE
- Threshold breach alerts, exception-expiry reminders
- Direct Tally ODBC or Xero API integration (phase 1 = manual Excel upload)
- DSO with sales data
- Customer/client portal
- FX auto-pull from API
- Write-off JE auto-generation
- Backfill of historical invoices (first-run = current open only)

---

## 2. Locked decisions (canonical list)

| # | Decision | Value |
|---|---|---|
| D1 | Stack | Python/FastAPI (backend) + React (frontend) + PostgreSQL |
| D2 | Upload semantics | Snapshot + upsert, match key `(entity_id, canonical_party_id, invoice_ref)` |
| D3 | Entities | 2 only: `IND` (Tally/INR), `UAE` (Xero/AED) |
| D4 | Auth | Google Workspace SSO only, domain-restricted `@emb.global` |
| D5 | Roles | `ANALYST` (entity-scoped upload/edit), `CFO` (read-only all entities), `ADMIN` (user mgmt + publish override), `PENDING` (default on first SSO login, zero perms) |
| D6 | Ageing buckets | `Not Due` / `0–30` / `31–60` / `61–90` / `90+` (days past our computed due date) |
| D7 | Due date formula | `due_date = invoice_date + credit_days_applied` |
| D8 | Credit days source priority | 1. Party-specific config → 2. Entity default → 3. Manual override (staging only) |
| D9 | Exception buckets (pre-seeded, admin can add more) | Legal/litigation, Disputed by client, Credit note pending, Written-off |
| D10 | Exception persistence | Tags attach to invoice (not snapshot). Auto-resolve on invoice settlement or material amount change (flag for review). |
| D11 | Party matching | Fuzzy (RapidFuzz/token_sort_ratio) + Alias master. Unmatched → queue for analyst resolution. Publish gated on zero unresolved aliases above 70% confidence. |
| D12 | Follow-up tracking | Structured: date, channel (email/call/whatsapp/meeting), contact_person, next_action_date, notes |
| D13 | Email triggers | Daily CFO digest @ 9 AM IST + publish notification (transactional) |
| D14 | Historical backfill | None. First snapshot = first upload. Document in UI that trend builds from week 1. |
| D15 | FX handling | Admin sets AED→INR rate per FY/period. `invoice_date` determines rate. Rate rows immutable. UAE dashboard = native AED. Consolidated = INR using pinned rate. |
| D16 | Write-off bucket | Dashboard classification only. No JE trigger. Must reconcile against Tally/Xero closing AR. |
| D17 | Publish override | Admin can publish on behalf of analyst. Audit log stamps `published_as = OVERRIDE`. CFO cannot override. |
| D18 | Digest timezone | IST only. Single scheduled job. UAE stakeholders receive at 7:30 AM GST (passive read, acceptable). |
| D19 | Reconciliation screen | Mandatory (A6). Analyst enters actual Tally/Xero closing AR per snapshot; system computes `Dashboard AR + Exception buckets − Tally/Xero AR` delta. Non-zero flagged. |
| D20 | UAE credit period sheet `Amount` column | Ignore. Parser drops it. Not stored, not displayed. |
| D21 | Hosting | **Railway**. FastAPI service + Postgres (Railway-managed) + React build served via FastAPI static mount OR separate Railway static site. Environment secrets via Railway env vars. |
| D22 | SMTP provider | **Resend (preferred) OR SendGrid.** Decision at first deploy. Criteria: Resend if simpler DX + cleaner template API is preferred; SendGrid if EMB already has an account or stricter deliverability analytics are required. Both need SPF + DKIM configured on `emb.global` DNS. |
| D23 | Wireframes/mockups | Claude Code produces them during Milestone 2. Format: HTML+Tailwind static mockups (one file per screen S1/S2/D1 minimum) OR low-fi ASCII layouts in `/wireframes/`. Tejaswa reviews before React implementation. |

---

## 3. Final data model (Postgres DDL-ready)

```
entities
  id SERIAL PK
  code            TEXT  UNIQUE  -- 'IND' | 'UAE'
  name            TEXT
  currency        TEXT          -- 'INR' | 'AED'
  default_credit_days INT       -- fallback when party has no config
  created_at      TIMESTAMPTZ

users
  id              SERIAL PK
  google_sub      TEXT UNIQUE   -- from Google SSO
  email           TEXT UNIQUE   -- must end in @emb.global
  name            TEXT
  role            TEXT          -- ANALYST | CFO | ADMIN | PENDING
  entity_id_scope INT FK entities(id)  -- nullable for CFO/ADMIN (all entities)
  active          BOOLEAN
  last_login      TIMESTAMPTZ
  created_at      TIMESTAMPTZ

fx_rates
  id              SERIAL PK
  from_ccy        TEXT          -- 'AED'
  to_ccy          TEXT          -- 'INR'
  rate            DECIMAL(18,6)
  valid_from      DATE
  valid_to        DATE          -- always NULL under D15 (reserved; see §7)
  set_by          INT FK users(id)
  set_at          TIMESTAMPTZ
  notes           TEXT
  -- rows are strictly immutable (D15); new rate = new row with new valid_from.
  -- Enforced by ORM before_flush hook + Postgres BEFORE UPDATE trigger +
  -- partial unique index on (from_ccy, to_ccy) WHERE valid_to IS NULL.

parties_canonical
  id              SERIAL PK
  entity_id       INT FK entities(id)
  name            TEXT
  created_by      INT FK users(id)
  created_at      TIMESTAMPTZ
  notes           TEXT
  UNIQUE(entity_id, name)

party_aliases
  id              SERIAL PK
  canonical_id    INT FK parties_canonical(id)
  alias_text      TEXT
  source          TEXT          -- 'TALLY' | 'XERO' | 'MANUAL'
  confidence      DECIMAL(5,2)  -- fuzzy match score at creation (0-100)
  confirmed_by    INT FK users(id)
  confirmed_at    TIMESTAMPTZ
  UNIQUE(alias_text, canonical_id)

credit_period_config
  id              SERIAL PK
  canonical_id    INT FK parties_canonical(id)
  days            INT
  reason_note     TEXT          -- for extended terms; UAE sheet has this
  valid_from      DATE
  valid_to        DATE          -- nullable = current
  updated_by      INT FK users(id)
  updated_at      TIMESTAMPTZ

snapshots
  id              SERIAL PK
  entity_id       INT FK entities(id)
  uploaded_by     INT FK users(id)
  upload_file_path TEXT
  upload_file_sha256 TEXT
  as_of_date      DATE          -- from upload header or user input
  published_at    TIMESTAMPTZ   -- null = STAGED
  published_by    INT FK users(id)
  published_as    TEXT          -- 'NORMAL' | 'OVERRIDE'
  row_count       INT
  total_outstanding DECIMAL(18,2)
  status          TEXT          -- STAGED | PUBLISHED | DISCARDED

invoices
  id              SERIAL PK
  entity_id       INT FK entities(id)
  canonical_id    INT FK parties_canonical(id)
  invoice_ref     TEXT
  invoice_date    DATE
  amount          DECIMAL(18,2)
  currency        TEXT
  credit_days_applied INT
  credit_days_source TEXT       -- CONFIG | DEFAULT | MANUAL
  due_date        DATE
  status          TEXT          -- OPEN | SETTLED
  first_seen_snapshot_id INT FK snapshots(id)
  settled_snapshot_id    INT FK snapshots(id) -- null if OPEN
  raw_row_json    JSONB         -- exact source row from Tally/Xero
  xero_metadata   JSONB         -- {invoice_seen, invoice_sent, project_id, service_month} for UAE
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
  UNIQUE(entity_id, canonical_id, invoice_ref)

invoice_snapshots
  id              BIGSERIAL PK
  snapshot_id     INT FK snapshots(id)
  invoice_id      INT FK invoices(id)
  as_of_date      DATE
  outstanding_amount DECIMAL(18,2)
  overdue_days    INT           -- can be negative for Not Due
  bucket          TEXT          -- NOT_DUE | 0_30 | 31_60 | 61_90 | 90_PLUS
  -- partition by as_of_date (quarterly) — plan from day 1

exception_bucket_types
  id              SERIAL PK
  code            TEXT UNIQUE   -- LEGAL | DISPUTED | CN_PENDING | WRITTEN_OFF | <admin-added>
  name            TEXT
  description     TEXT
  active          BOOLEAN
  created_at      TIMESTAMPTZ

exception_tags
  id              SERIAL PK
  invoice_id      INT FK invoices(id)
  bucket_type_id  INT FK exception_bucket_types(id)
  reason          TEXT NOT NULL
  tagged_by       INT FK users(id)
  tagged_at       TIMESTAMPTZ
  expected_resolution_date DATE
  status          TEXT          -- ACTIVE | RESOLVED | AUTO_RESOLVED
  resolved_at     TIMESTAMPTZ
  resolved_by     INT FK users(id)
  resolution_note TEXT

follow_ups
  id              SERIAL PK
  invoice_id      INT FK invoices(id)  -- nullable for party-level
  canonical_id    INT FK parties_canonical(id)
  date            DATE
  channel         TEXT          -- EMAIL | CALL | WHATSAPP | MEETING
  contact_person  TEXT
  next_action_date DATE
  notes           TEXT
  logged_by       INT FK users(id)
  logged_at       TIMESTAMPTZ

reconciliation_entries
  id              SERIAL PK
  snapshot_id     INT FK snapshots(id)
  tally_xero_closing_ar DECIMAL(18,2)   -- manually entered
  dashboard_ar    DECIMAL(18,2)         -- computed
  exception_bucket_total DECIMAL(18,2)  -- computed
  delta           DECIMAL(18,2)         -- computed
  status          TEXT                  -- MATCHED | MISMATCHED | UNRECONCILED
  entered_by      INT FK users(id)
  entered_at      TIMESTAMPTZ
  notes           TEXT

email_rules
  id              SERIAL PK
  type            TEXT          -- DAILY_DIGEST | PUBLISH_NOTIF
  recipients_json JSONB
  schedule_cron   TEXT          -- null for transactional
  active          BOOLEAN
  updated_by      INT FK users(id)
  updated_at      TIMESTAMPTZ

email_log
  id              BIGSERIAL PK
  rule_id         INT FK email_rules(id)
  sent_at         TIMESTAMPTZ
  recipients      TEXT[]
  subject         TEXT
  body_html       TEXT
  status          TEXT          -- SENT | FAILED
  error           TEXT

audit_log
  id              BIGSERIAL PK
  actor_id        INT FK users(id)
  action          TEXT          -- e.g. 'snapshot.publish', 'exception.tag', 'user.role_change'
  entity_type     TEXT
  entity_id       TEXT
  before_json     JSONB
  after_json      JSONB
  ip_address      INET
  ts              TIMESTAMPTZ
```

### Indexes (non-negotiable)
- `invoices (entity_id, canonical_id, invoice_ref)` — already UNIQUE
- `invoices (status) WHERE status = 'OPEN'`
- `invoice_snapshots (snapshot_id)`
- `invoice_snapshots (as_of_date, bucket)` — for dashboard queries
- `exception_tags (invoice_id, status)`
- `follow_ups (canonical_id, date DESC)`
- `audit_log (ts DESC)`
- Partition `invoice_snapshots` by `as_of_date` quarterly.

---

## 4. Parser specs (against actual sample files)

### 4.1 Tally — `GrpBills.xlsx`

**Shape:**
- Sheet: `Sundry Debtors`
- Rows 0–4 = metadata (Group name, date range, "Pending Bills" header)
- Row 3 = first header row: `Date | Ref. No. | Party's Name | Opening | Pending | Due on | Overdue`
- Row 4 = second header row: `_ | _ | _ | Amount | Amount | _ | by days`
- Row 5 onwards = data

**Parser rules:**
1. Skip rows 0–4. Normalize headers as: `date, ref_no, party_name, opening_amount, pending_amount, due_on, overdue_days`.
2. Rows where `party_name` is populated AND `ref_no`/`date` are empty = **party header row**. Forward-fill `party_name` to subsequent rows until next party header.
3. Rows where `date` AND `ref_no` are populated = **invoice row**. Extract: invoice_date=`date`, invoice_ref=`ref_no`, amount=`pending_amount`, party=forward-filled name.
4. Rows where `date` and `ref_no` are empty BUT `opening_amount`/`pending_amount` are populated = **party sub-total row**. SKIP. (Validation only: sub-total should equal sum of that party's invoice rows — log warning if mismatch >1 rupee.)
5. Drop `due_on` and `overdue_days` columns — we compute our own. Keep `opening_amount` in `raw_row_json` but do not use for ageing.
6. Source currency = `INR` always (India entity).

**Validation:** (amended 2026-04-17, re-amended same day — see ADR-0003 + its addendum. Empirically no sum-of-X == Y reconcile holds on real Tally GrpBills exports because Tally nets at **both** party and group levels.)

- **Primary safety net — per-row classification completeness:** every non-metadata, non-grand-total row must be classified by the parser as exactly one of: `party_header`, `invoice_row`, `party_subtotal`, `blank`. Any row the parser cannot classify is emitted as a `StagedInvoice` with `status=PARSE_ERROR` and a non-empty `parse_error_reason`. Analyst sees these in M3 staging; publish gate (§5) blocks publication until they're resolved. This — not any sum-reconcile — is the real "parser dropped rows" detector.
- **Warnings — non-blocking, for analyst review (`result.warnings`):**
  - `SUBTOTAL_MISMATCH`: per-party sub-total ≠ sum of that party's invoice `pending_amount` rows within ₹1. Expected on parties with unallocated credits (e.g. advance receipts).
  - `GRAND_TOTAL_MISMATCH`: sum of party sub-totals ≠ grand total row within ₹1. Expected on most real files because Tally applies group-level netting beyond party-level. Not blocking — file-level reconcile is structurally not available from Tally's report.
  - `UNALLOCATED_CREDITS_DELTA`: sum of invoice `pending_amount` minus grand total. Always emitted for auditability; surfaces book-level unallocated-credit exposure.
- **No `as_of_date` sniffing:** Tally headers do not reliably carry one. Parser leaves `ParseResult.as_of_date = None`; M3 upload pipeline supplies it from the upload form. The "invoice_dates ≤ as_of_date" check therefore runs in M3, not in the parser.
- **`ParseResult.is_valid` semantics:** True iff `errors == []`. PARSE_ERROR *rows* (status on a `StagedInvoice`) do NOT flip `is_valid=False` — row-level issues are a staging concern, not a parse-time block. In practice the Tally parser's `errors` list stays empty on a clean file; all safety signals surface via warnings or per-row PARSE_ERROR status.

### 4.2 Xero — `Aged Receivables Detail.xlsx`

**Shape:**
- Sheet: `Aged Receivables Detail`
- Rows 0–3 = metadata (Report title, entity name, "As at DD Month YYYY", "Ageing by due date")
- Row 5 = header row: `Contact Account Number | Primary Person | Phone | Email | Mobile | Contact Group | ... | Total | Outstanding Tax | PROJECT ID | SERVICE MONTH | Invoice Seen | Invoice Sent`
- Data rows follow, interleaved with party sub-totals and grand total

**Parser rules:**
1. Sniff "As at DD Month YYYY" from row 2 → that's the `as_of_date`.
2. Skip rows 0–5 metadata+header. Normalize headers from row 5.
3. Rows where `Contact Account Number` is populated but other fields empty = **party header row**. Forward-fill party name.
4. Rows where party name starts with literal `"Total "` = **sub-total or grand-total row**. SKIP.
5. Invoice rows: extract invoice_date (col to confirm from real sample — likely `Invoice Date`), `Reference` → invoice_ref, `Due Date` (ignored for ageing), `Total` → amount, `Outstanding Tax` → stored but not used.
6. Preserve UAE-specific columns into `xero_metadata` JSONB: `invoice_seen`, `invoice_sent`, `project_id`, `service_month`, `primary_person`, `email`.
7. Source currency = `AED` always (UAE entity).

**Validation:**
- Grand total must match sum of invoice rows. Tolerance: AED 1.
- Warn if `Invoice Seen = "Not seen"` count >20% of rows (likely a data hygiene issue analyst should see).

### 4.3 Credit Period config — `Credit Period for Accounts - India & UAE.xlsx`

**Shape:**
- Sheet `India`: `Client Name | Credit Period` (2 cols)
- Sheet `UAE`: `Client Name | Credit Period | Reason for extended Credit Period | Amount` (4 cols)

**Parser rules:**
1. India sheet: extract `(name, credit_days)` pairs. `credit_days=0` is valid (immediate payment).
2. UAE sheet: extract `(name, credit_days, reason_note)`. **Drop `Amount` column entirely** (per D20).
3. Empty `Client Name` rows = SKIP.
4. Duplicate party names on the same sheet → FAIL upload, return list of dupes for user to fix.
5. On import, for each row: find/create `parties_canonical`, upsert into `credit_period_config` with `valid_from = today`, close prior open row with `valid_to = today - 1 day`.

### 4.4 Common parser behavior

- All parsers return a normalized `StagedInvoice` / `StagedCreditPeriod` dataclass.
- Every parsed row carries its original row index (for error messages).
- Never silently drop invoice rows. Unparseable row = staged as `PARSE_ERROR` for analyst to see and fix.
- Store original file SHA-256 in `snapshots.upload_file_sha256` — reject duplicate re-uploads of the same file.

---

## 5. Ingestion pipeline (state machine)

```
UPLOAD → PARSING → STAGING → REVIEW → PUBLISHED
                                  ↓
                              DISCARDED
```

1. **UPLOAD**: file received, SHA-256 computed, `snapshots` row created with `status=STAGED`.
2. **PARSING**: parser runs; produces N staged invoices + validation report.
3. **STAGING**: each staged invoice resolved against party alias master:
   - Exact alias match → canonical_id resolved
   - Fuzzy match ≥ 90% → auto-suggest, requires analyst confirm
   - Fuzzy match 70–89% → analyst must confirm or reject
   - Fuzzy match < 70% → treated as unmapped, analyst creates alias or new canonical party
4. **REVIEW**: analyst sees staging grid. Must resolve all unmapped + <90% fuzzy rows. Credit period auto-applied (config → default → manual override).
5. **PUBLISH**: button. Guards:
   - Zero unmapped parties
   - All validation warnings acknowledged
   - User has publish rights for this entity (ANALYST scoped, or ADMIN override)
   - Upsert into `invoices` + write `invoice_snapshots` rows + mark absent-from-this-upload invoices as SETTLED
   - Fire `PUBLISH_NOTIF` email
   - Write audit log entry

---

## 6. Ageing calc

```python
def compute_ageing(invoice_date, credit_days, as_of_date):
    due_date = invoice_date + timedelta(days=credit_days)
    overdue_days = (as_of_date - due_date).days
    if overdue_days < 0:
        bucket = "NOT_DUE"
    elif overdue_days <= 30:
        bucket = "0_30"
    elif overdue_days <= 60:
        bucket = "31_60"
    elif overdue_days <= 90:
        bucket = "61_90"
    else:
        bucket = "90_PLUS"
    return due_date, overdue_days, bucket
```

- `as_of_date` comes from the snapshot, NOT `datetime.today()`. This is critical — historical snapshots must be reproducible.
- `credit_days` source priority: party config → entity default → manual staging override.

---

## 7. FX conversion rules

1. AED→INR rate lookup: find all `fx_rates` rows where `from_ccy='AED' AND to_ccy='INR' AND valid_from <= invoice.invoice_date`, then pick the one with `MAX(valid_from)`. Rate rows are strictly immutable (D15); `valid_to` plays no role in lookup and in practice stays NULL on every row. The column is retained in the schema as an escape hatch if the total-immutability contract is ever relaxed.
2. Applied only for consolidated view. UAE dashboard shows native AED.
3. Missing rate = FAIL the consolidated view render with explicit error "No FX rate configured for invoice date 2026-03-15, please set in Admin → FX Rates".
4. Rate rows are strictly immutable (D15) — enforced belt-and-suspenders by (a) an ORM `before_flush` hook in `app/db/events.py` and (b) a Postgres `BEFORE UPDATE` trigger installed by migration `0001_initial`. To change a rate, admin inserts a NEW row with a new `valid_from`; the prior row is never modified. A partial unique index on `(from_ccy, to_ccy) WHERE valid_to IS NULL` enforces "at most one currently-open row per currency pair" at the DB level.
5. Every INR figure in consolidated view carries a tooltip: "Converted at AED→INR {rate} effective from {valid_from}". (No upper bound shown — rows are immutable, so the displayed rate was the active one from `valid_from` until at least the next row's `valid_from`; the tooltip leaves the implicit upper bound out.)

---

## 8. Email specs

### 8.1 Daily CFO Digest (9 AM IST, Mon–Fri)
- **Recipients:** configurable via `email_rules`. Default = CFO + Tejaswa.
- **Subject:** `EMB Receivables Digest — {IST date}`
- **Body sections:**
  1. Headline table: Total Outstanding (INR, AED, INR-consolidated), Total Overdue, 90+ bucket, delta vs yesterday, both entities.
  2. Ageing table by bucket, both entities.
  3. Top 10 overdue parties (consolidated), with last follow-up date.
  4. Exception bucket summary.
  5. Reconciliation status per entity (last snapshot: matched / mismatched / unreconciled).
  6. Footer: link to dashboard, "generated at {time}", "FX rate used: {rate} effective {dates}".
- **Delivery:** Gmail SMTP via Google Workspace service account, or SendGrid with SPF/DKIM aligned for `emb.global`. Decide at deploy time.

### 8.2 Publish Notification (transactional)
- **Recipients:** CFO + Admins.
- **Subject:** `[{entity_code}] AR snapshot published for {as_of_date}`
- **Body:**
  - Who published, when, override flag
  - Diff vs previous snapshot: new invoices N, settled M, bucket shifts, new exceptions tagged
  - Row count, total outstanding
  - Link to dashboard drill-down

---

## 9. Screen list (for React routing)

| Code | Route | Role | Notes |
|---|---|---|---|
| S1 | `/upload` | ANALYST, ADMIN | Drop zone + pre-flight |
| S2 | `/staging/:snapshot_id` | ANALYST, ADMIN | Review before publish |
| S3 | `/config/credit-period` | ANALYST, ADMIN | Master list per entity |
| S4 | `/config/aliases` | ANALYST, ADMIN | Canonical + alias mgmt |
| S5 | `/exceptions` | ANALYST, ADMIN | Invoice-level bucket tagging |
| S6 | `/follow-ups` | ANALYST, ADMIN | Log + timeline |
| D1 | `/dashboard` | ALL (non-PENDING) | KPI + ageing + top 10 + trend + exceptions |
| D2 | `/party/:id` | ALL | Drill-down |
| D3 | `/invoice/:id` | ALL | Full lineage + raw row |
| A1 | `/admin/users` | ADMIN | Includes PENDING user approvals |
| A2 | `/admin/emails` | ADMIN | Recipients + cron |
| A3 | `/admin/exception-buckets` | ADMIN | |
| A4 | `/admin/fx-rates` | ADMIN | Immutable rows, changelog |
| A5 | `/admin/audit-log` | ADMIN | Filterable |
| A6 | `/admin/reconciliation` | ANALYST (read), ADMIN | Per-snapshot delta check |
| — | `/pending` | PENDING | "Awaiting role assignment" landing |

---

## 10. API endpoints (contract)

All endpoints require valid Google SSO session cookie. RBAC enforced per endpoint.

```
# Auth
POST   /auth/google/callback       # SSO callback
POST   /auth/logout
GET    /auth/me                    # current user + role + scope

# Upload pipeline
POST   /snapshots                  # multipart upload; returns snapshot_id + parse report
GET    /snapshots/:id/staging      # staged invoices + alias suggestions
PATCH  /snapshots/:id/staging/:row # resolve alias / credit period override
POST   /snapshots/:id/publish      # guards: all resolved, rbac
POST   /snapshots/:id/discard

# Config
GET/POST/PATCH/DELETE /config/credit-period
GET/POST/PATCH/DELETE /config/aliases
GET/POST              /config/fx-rates   # no DELETE or PATCH — rows immutable per D15 (trigger-enforced)
GET/POST/PATCH        /config/exception-buckets

# Data
GET    /dashboard?entity=IND|UAE|ALL&as_of=
GET    /parties/:id
GET    /invoices/:id
GET    /invoices?filters=...       # for exception + follow-up screens

# Exceptions + follow-ups
POST   /invoices/:id/exceptions
PATCH  /exceptions/:id             # resolve
POST   /invoices/:id/follow-ups    # or /parties/:id/follow-ups
GET    /follow-ups?party_id=

# Reconciliation
POST   /reconciliation             # analyst enters Tally/Xero closing AR for snapshot
GET    /reconciliation?snapshot_id=

# Admin
GET/POST/PATCH /admin/users
GET            /admin/audit-log
GET/POST/PATCH /admin/email-rules
```

---

## 11. Non-functional requirements

| Concern | Requirement |
|---|---|
| Hosting | **Railway.** Two services: `backend` (FastAPI, Python 3.12) + `postgres` (Railway-managed). Frontend: build React and serve via FastAPI `StaticFiles` (single-service deploy, cheapest) OR deploy as a separate Railway static site. Start with single-service. |
| Postgres | Railway Postgres add-on. Use connection string from Railway env var. Enable automated daily backups in Railway settings. |
| Backup | Railway's built-in daily backup + weekly `pg_dump` dropped into Railway's volume or S3 for 30-day retention. |
| Secrets | Railway env vars. Never `.env` in repo. Use `pydantic-settings` to read env. Required vars: `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_ALLOWED_DOMAIN=emb.global`, `SESSION_SECRET`, `SMTP_API_KEY` (Resend or SendGrid), `SMTP_FROM_ADDRESS`, `S3_*` if using object storage. |
| Email provider | **Resend (default) or SendGrid.** Both need `emb.global` SPF + DKIM DNS records before first send — get EMB IT to add them during Milestone 1. Use provider's Python SDK. `From:` = `receivables-bot@emb.global` or similar subdomain. |
| Logging | Structured JSON to stdout (Railway captures this). Use `structlog`. |
| Timezone | Server stores UTC. All display in IST. UAE entity views can show GST. Scheduler (digest cron) runs in UTC, converted to IST 9AM = UTC 03:30. |
| File retention | Uploaded Excel files stored in Railway volume (or S3 bucket if set up) keyed by `snapshot_id`. Retained indefinitely for audit. |
| PII | Party names + emails present. Access restricted by role. No external 3rd-party analytics. |
| Rate limiting | 60 req/min per user (standard) — use `slowapi`. |
| Session timeout | 12 hours idle. Sessions stored server-side keyed in Redis (Railway Redis add-on) OR signed cookies with `itsdangerous`. Start with signed cookies. |
| Scheduler | Built-in FastAPI startup: `APScheduler` with Postgres job store (so digest doesn't double-fire on Railway redeploy). Single cron job: daily digest at UTC 03:30 (IST 09:00). |

---

## 12. Testing requirements

- **Parser tests (highest priority):** unit tests against the 3 actual sample files in `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/`. At minimum:
  - Tally: correct party forward-fill, sub-total rows skipped, grand total reconciles
  - Xero: `"Total "` rows skipped, xero_metadata preserved, as_of_date sniffed correctly
  - Credit Period: Amount col dropped, dupes rejected, 0-day valid
- **Ageing calc tests:** boundary conditions (exactly 0, 30, 31, 60, 61, 90, 91 days overdue), `as_of_date` in past
- **FX tests:** invoice on rate-boundary date, missing rate error, multi-period span
- **Upsert tests:** same invoice in 3 consecutive snapshots with changing amounts; invoice dropping out → SETTLED transition
- **RBAC tests:** analyst cannot publish other entity, CFO cannot edit, PENDING sees only /pending
- **Publish guards:** unmapped parties block publish; admin override logged
- **E2E test:** full flow from upload → staging → publish → dashboard reflects → email fires (mock SMTP)

---

## 13. Consequences re-flagged for implementation

These are the sharp edges. If any of these logic points is skipped, the platform produces wrong numbers:

1. **Exception auto-resolution:** when invoice status flips to SETTLED, cascade-update active exception_tags to `AUTO_RESOLVED`. Without this, zombie exceptions accumulate.
2. **Material amount change on re-upload:** if invoice amount changes by >5% between snapshots AND an active exception exists, flag the exception with a review-required banner.
3. **FX rate pinning by invoice_date:** never `datetime.today()`. Historical consolidated trend must be reproducible.
4. **Tally overdue column:** Tally ships its own `overdue_days`. We compute ours. UI must show both with a tooltip: "Our calc uses EMB credit period master. Tally's figure: {tally_days}. Ours: {our_days}." Without this, analysts cross-check and lose trust on day 1.
5. **Default credit period is load-bearing:** build a "Parties on default credit period" report visible on S3 (Credit Period Config). Weekly email nudge to analyst listing them.
6. **Reconciliation screen (A6) is a guardrail, not a feature:** a write-off tag makes dashboard AR < Tally AR by the write-off amount. A6 forces analysts to enter Tally closing AR → system computes delta → must match exception bucket total. Non-match = block next publish until reconciled.
7. **PENDING role:** new SSO users land in PENDING. Admin-notify on first login. Without this, any `@emb.global` user can authenticate and see AR.
8. **Audit log on everything:** publish, exception tag/resolve, config change, role change, FX rate change. `before_json` + `after_json` preserved.

### Deployment-specific consequences (Railway + Resend/SendGrid)

9. **Railway sleeps free-tier services.** If this is deployed on Railway's Hobby/free tier, the service can sleep and the 9 AM IST digest may not fire. Use Railway Pro OR use an external scheduler (EasyCron, GitHub Actions cron) hitting a webhook as backup trigger. Recommendation: Railway Pro, simpler.
10. **APScheduler + multi-instance = double-fire risk.** If Railway scales to >1 instance, digest fires twice. Pin backend to 1 replica OR use `APScheduler` with Postgres job store + `SQLAlchemyJobStore` which handles locks. Either is fine for phase 1; the 1-replica approach is simpler.
11. **Railway redeploys drop in-memory state.** Sessions must survive redeploy → use signed cookies OR Redis (do not use in-memory session store).
12. **SPF/DKIM DNS propagation has lead time.** Adding `emb.global` SPF/DKIM records takes hours. Block Milestone 6 on this — don't discover it late. Start this in Milestone 1.
13. **Resend free tier = 100 emails/day, 3,000/month.** Daily digest + publish notifications stay well under this. But any phase 2 blast (e.g., client reminders) will blow through. Plan for paid tier before phase 2 launch.
14. **`From:` address and subdomain choice.** If you send from `receivables-bot@emb.global` and hit a deliverability issue, it affects the whole `emb.global` domain's reputation. Safer pattern: use a dedicated subdomain like `mail.embfinops.emb.global` or `noreply@app.emb.global` with its own DKIM — isolates reputation. Discuss with IT.
15. **Railway Postgres backup vs pg_dump.** Railway's automated backup is convenient but is locked to their platform. Weekly `pg_dump` to S3 or local volume ensures portability if you ever migrate off Railway. Do both.
16. **Wireframe sign-off gate between M2 and M4.** Don't build React screens (M4 dashboard) until Tejaswa has reviewed HTML wireframes. Skipping this gate = rework risk. M3 ingestion can run in parallel because it's API-only.

---

## 14. Implementation roadmap (suggested phasing)

**Milestone 1 — Foundations + Deploy Skeleton (Week 1)**
- Repo scaffold (monorepo: `/backend`, `/frontend`, `/wireframes`), Dockerfile for Railway
- Postgres migrations via Alembic
- Entities + fx_rates + users tables + Google SSO + role middleware
- PENDING user flow + admin approval
- **Deploy skeleton to Railway on day 3.** Push an empty "hello world" FastAPI + static React up so we hit deployment issues early, not in Milestone 7.
- Ping EMB IT to add SPF + DKIM records for Resend/SendGrid to `emb.global` (this has lead time).

**Milestone 2 — Parsers + Wireframes (Week 2) — DE-RISK FIRST**
- Tally parser + Xero parser + Credit Period parser
- Unit tests against actual sample files in `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/`
- Ageing calc module with boundary tests
- **Wireframes:** HTML+Tailwind static mockups for S1, S2, D1, S5 (Exception Manager), A6 (Reconciliation). Saved to `/wireframes/` in repo. Tejaswa reviews and signs off before Milestone 4.

**Milestone 3 — Ingestion pipeline (Week 3)**
- Upload endpoint + snapshot state machine
- Alias master + fuzzy matching
- Staging review API
- Publish with upsert + settled-transition logic

**Milestone 4 — Dashboard + drill-downs (Week 4)**
- D1/D2/D3 endpoints + React screens
- KPI computation + trend from invoice_snapshots
- FX conversion for consolidated view

**Milestone 5 — Exceptions + follow-ups (Week 5)**
- S5 + S6 screens + API
- Exception auto-resolution on settle
- Stale-follow-up flag

**Milestone 6 — Admin + emails + reconciliation (Week 6)**
- A1–A6 screens
- Daily digest cron (9 AM IST)
- Publish notification emailer
- Reconciliation view (A6) with publish-gate logic

**Milestone 7 — Hardening + UAT (Week 7)**
- RBAC test suite green
- E2E test green
- Deploy staging → analyst UAT
- Audit-log review

**Milestone 8 — Production cutover (Week 8)**
- DNS verification complete (SPF/DKIM added in M1 should be live by now)
- Railway Pro plan active (no sleeping)
- Backup job running (Railway auto-backup + weekly pg_dump to S3)
- Go-live with Tejaswa + Admin only
- First live snapshot
- Monitor for 1 week before inviting CFO

### Deployment checklist (for M8 cutover)
- [ ] Railway backend service: deployed, healthy, 1 replica
- [ ] Railway Postgres: connected, migrations applied, backup enabled
- [ ] DNS: SPF, DKIM, DMARC records on `emb.global` verified in Resend/SendGrid dashboard
- [ ] Google OAuth: production client ID, authorized redirect URIs include Railway domain
- [ ] Domain: custom domain (e.g., `ar.emb.global`) pointed at Railway, HTTPS cert issued
- [ ] First admin user seeded via CLI (Tejaswa)
- [ ] Test email sent end-to-end (publish-notif to test address)
- [ ] Test daily digest triggered manually via admin endpoint
- [ ] Audit log table non-empty after first publish
- [ ] Railway env vars: all set, none hardcoded

---

## 15. Things Claude Code should NOT do

- Do not invent credit period defaults. Entity defaults come from admin config.
- Do not auto-backfill historical data (D14).
- Do not allow FX rate row mutation after creation (D15).
- Do not silently skip unparseable rows — stage them as errors.
- Do not use Tally's `overdue_days` or `due_on` columns for ageing.
- Do not let CFO or PENDING users publish or edit anything.
- Do not persist the UAE credit period `Amount` column (D20).
- Do not email the CFO until Tejaswa explicitly flips the email rule to active.
- Do not deploy to a hosting platform other than Railway (D21) without explicit approval.
- Do not start M4 (dashboard React build) before M2 wireframes are signed off by Tejaswa (D23).
- Do not commit `.env`, Railway credentials, Resend/SendGrid API key, or Google OAuth secrets to the repo.
- Do not run the scheduler on >1 replica unless using Postgres job store with locks.

---

## 16. Files and paths

| Purpose | Path |
|---|---|
| Working folder | `/sessions/upbeat-peaceful-ramanujan/mnt/EMB MIS - Indirect Expenses/receivables_ageing_dashboard/` |
| Handoff spec (this doc) | `02_HANDOFF_SPEC.md` |
| Full brainstorm with rationale | `01_brainstorm_screens_and_features.md` |
| Sample — Tally India | `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/GrpBills.xlsx` |
| Sample — Xero UAE | `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/52b88059-e25e-425d-ad14-63f756db9537-1776338283750_MANTARAV_DIGITAL_INFORMATION_TECHNOLOGY_CONSULTANCY_-_SOLE_PROPRIETORSHIP_L_L_C__-_Aged_Receivables_Detail_-_For_Dashboard_-_Tejas.xlsx` |
| Sample — Credit Period Config | `/sessions/upbeat-peaceful-ramanujan/mnt/uploads/Credit Period for Accounts - India & UAE.xlsx` |

---

## 17. Point of contact

**Tejaswa Sharma** — `tejaswa.sharma@emb.global` — Revenue Ops / Data Analytics, EMB Global.

Anything not covered here: ask, don't assume.

**End of handoff spec.**
