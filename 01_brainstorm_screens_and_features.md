# Receivables Ageing Dashboard — Phase 1 Brainstorm

**Owner:** Tejaswa Sharma
**Date:** 2026-04-16
**Scope:** India (Tally) + UAE (Xero) only. Internal EMB Global tool.
**Status:** Pre-build design — screens, features, data model, open questions.

---

## 1. Locked decisions (from this session)

| # | Decision | Choice |
|---|---|---|
| 1 | Upload semantics | Snapshot + Upsert by Invoice |
| 2 | Roles | Analyst, CFO/Mgmt (read-only), Admin |
| 3 | Exception buckets | Legal, Disputed, Credit note pending, Written-off |
| 4 | Email triggers | Daily CFO digest (9 AM) + New-upload-published |
| 5 | Party matching | Fuzzy match + Alias master |
| 6 | Ageing buckets | Not Due / 0–30 / 31–60 / 61–90 / 90+ |
| 7 | Stack | Python/FastAPI + React + Postgres |
| 8 | Follow-up tracking | Full structured log per invoice/party |

---

## 2. User roles & permission matrix

| Capability | Analyst | CFO / Mgmt | Admin |
|---|:-:|:-:|:-:|
| Upload Tally/Xero file | ✓ | — | ✓ |
| View raw + staging data | ✓ | — | ✓ |
| Publish snapshot (makes dashboard update) | ✓ (own entity) | — | ✓ (any entity — override) |
| Manage credit period config | ✓ | — | ✓ |
| Create/edit party aliases | ✓ | — | ✓ |
| Tag invoices into exception buckets | ✓ | — | ✓ |
| Log follow-up activity | ✓ | — | ✓ |
| View dashboard (entity-scoped) | ✓ (own entity) | ✓ (all entities) | ✓ |
| Drill-down to invoice level | ✓ | ✓ | ✓ |
| Export to Excel/PDF | ✓ | ✓ | ✓ |
| Manage users / roles | — | — | ✓ |
| Configure email triggers | — | — | ✓ |
| Manage exception bucket types | — | — | ✓ |
| Audit trail view | — | — | ✓ |

**Entity scoping:** Analyst is bound to one entity (India OR UAE). CFO and Admin see both.

---

## 3. Screen inventory

### 3.1 Auth & Shell
- **Login** — Google Workspace SSO only (`@emb.global` domain-restricted). No local password flow.
- First-time login: user auto-created with role=`PENDING`, no permissions. Admin gets a notification to assign role + entity scope. User sees "Awaiting role assignment" landing until provisioned.
- **App shell** — left nav, entity switcher (top-right, India 🇮🇳 / UAE 🇦🇪), user avatar menu, sign-out via Google.

### 3.2 Analyst screens

**S1. Upload & Ingest**
- Drop zone: accepts `.xlsx`. Auto-detects source (Tally GrpBills vs Xero Aged Receivables) via sheet name + column signature. Manual override dropdown.
- Pre-flight validation panel: row count, date range detected, parties found, parties with no credit period config, parties with fuzzy-match suggestions, total outstanding.
- "Stage" button → parses into staging table. "Review" → next screen.

**S2. Staging Review**
- Table of parsed invoices with columns: Party (resolved), Invoice Ref, Invoice Date, Amount, Credit Period (source: config / default / manual), Due Date, Overdue Days, Bucket, Match Confidence.
- Rows flagged:
  - 🔴 No credit period config → inline dropdown: pick alias or set override
  - 🟡 Fuzzy match suggested → accept / reject / create new alias
  - 🟢 Clean
- Bulk actions: accept all high-confidence matches, apply default credit period to unmapped.
- **Publish** button (terminal action) — writes to production snapshot, triggers "New upload published" email, becomes visible to CFO. Requires all 🔴 rows resolved.

**S3. Credit Period Config**
- Master list per entity. Columns: Party, Credit Period (days), Reason for extension (if non-standard, e.g., UAE sheet already has this), Valid From, Last Updated By.
- Bulk import from Excel (re-uses the uploaded config file format).
- Changelog column — every edit tracked.
- **Default credit period** setting (entity-level) — e.g., India default = 30, UAE default = 30. Applied when party has no explicit config.

**S4. Party Alias Master**
- Canonical party → list of aliases seen in Tally/Xero uploads.
- Add alias manually. Merge two canonical parties (dedupe). View all invoices under canonical.
- Fuzzy suggestions queue: unresolved from prior uploads.

**S5. Exception Manager**
- Invoice-level table. Filters: bucket, party, date range, status.
- Columns: Invoice, Party, Amount, Overdue Days, Exception Bucket, Reason/Note, Tagged By, Tagged On, Expected Resolution Date, Status (Active / Resolved).
- Add/remove bucket inline. Free-text reason mandatory.
- **Persistence rule:** an exception tag on an invoice carries over across snapshots until analyst marks it Resolved OR invoice is settled.

**S6. Follow-up Log**
- Per-invoice or per-party view.
- Add entry: date, channel (email / call / whatsapp / meeting), person contacted, next action date, notes.
- Timeline view per party → useful for escalation meetings.
- "Stale" flag: overdue invoice with no follow-up in last X days (configurable, default 14).

### 3.3 CFO / Management screens

**D1. Executive Dashboard (landing)**
- KPI strip (per entity, toggleable):
  - Total Outstanding
  - Total Overdue (past due date)
  - 90+ bucket value + % of total
  - DSO (Days Sales Outstanding) — if sales data available, otherwise show "simple average ageing"
  - WoW / MoM delta arrows
- **Ageing waterfall bar chart** — 5 buckets stacked by entity.
- **Top 10 overdue parties** — table with party, amount, oldest invoice, exception tags, last follow-up.
- **Trend line** — total outstanding + 90+ bucket, weekly snapshots, last 12 weeks.
- **Exception summary** — how much AR is "parked" in each exception bucket.
- Entity toggle + consolidated view (INR-normalised — use a configurable FX rate, stored in admin).

**D2. Party Drill-down**
- Click any party → full invoice list, follow-up timeline, exception history, credit period config in use.

**D3. Invoice Drill-down**
- Full lineage: upload source file, upload date, raw row, applied credit period source, follow-up log, exception history.

### 3.4 Admin screens

**A1. User Management** — CRUD users, assign role + entity scope, approve `PENDING` users on first SSO login.
**A2. Email Rules** — edit daily digest recipients, time, template, threshold alerts (phase 2).
**A3. Exception Bucket Config** — add/rename/archive bucket types.
**A4. FX Rates** — AED→INR rate per FY/period. Immutable once set (creates a new row for changes). Changelog visible.
**A5. Audit Log** — every publish, exception tag, config edit, user change. Filterable.
**A6. Tally/Xero Reconciliation View** — shows: `Sum of dashboard AR (by entity) + Sum of exception buckets = expected Tally/Xero AR`. Analyst enters actual Tally/Xero closing AR per snapshot; system computes delta. Non-zero delta is flagged. Non-negotiable guardrail against write-off tags creating silent divergence.

---

## 4. Core workflows

### 4.1 Weekly upload flow (analyst)
1. Log in → S1 Upload → drop Tally/Xero file.
2. System parses → shows pre-flight stats.
3. Go to S2 Staging → resolve 🔴 and 🟡 rows (alias suggestions + credit period fills).
4. Click Publish → snapshot written, email fires, CFO view refreshes.
5. If new exceptions need tagging post-publish → S5 Exception Manager → tag → does NOT require republish, just updates live view (with audit entry).

### 4.2 Upsert logic (snapshot + upsert by invoice)
- Match key: `(entity, canonical_party_id, invoice_ref_no)`.
- On upload:
  - **New** invoice (not seen before) → insert into `invoices` + snapshot row.
  - **Existing open** invoice → update amount, overdue days, recompute bucket; preserve exception tags + follow-up log; snapshot row written.
  - **Existing invoice not in new upload** (implicit settlement) → mark `status = settled`, `settled_date = snapshot_date`. Show as "Recently settled" for 30 days for verification.
- Snapshot table preserves every as-of view → feeds the trend chart.

### 4.3 Email triggers
- **Daily CFO Digest (9 AM IST)** — scheduled job. Body = KPI strip + top 10 overdue + exception totals, both entities. Delta vs yesterday.
- **New upload published** — transactional, fires on publish event. Body = diff summary (new invoices, settled, bucket shifts, new exceptions added).

---

## 5. Data model (sketch)

```
entities (id, code=IND/UAE, name, currency, default_credit_days)
fx_rates (id, from_ccy, to_ccy, rate, valid_from, valid_to, set_by, set_at, notes)
           -- invoice_date determines which row applies; rows are immutable once set
users (id, google_sub, email, name, role=ANALYST/CFO/ADMIN/PENDING, entity_id_scope, active, last_login)
parties_canonical (id, entity_id, name, created_at, notes)
party_aliases (id, canonical_id, alias_text, source=TALLY/XERO, confidence, confirmed_by, confirmed_at)
credit_period_config (id, canonical_id, days, reason_note, valid_from, updated_by, updated_at)

invoices (id, entity_id, canonical_id, invoice_ref, invoice_date, amount, currency,
          credit_days_applied, credit_days_source=CONFIG/DEFAULT/MANUAL,
          due_date, status=OPEN/SETTLED, first_seen_snapshot_id, settled_snapshot_id, raw_row_json)

invoice_snapshots (id, snapshot_id, invoice_id, as_of_date, outstanding_amount,
                   overdue_days, bucket)

snapshots (id, entity_id, uploaded_by, upload_file_path, as_of_date, published_at,
           published_by, published_as=NORMAL/OVERRIDE, row_count, total_outstanding,
           status=STAGED/PUBLISHED)

exception_tags (id, invoice_id, bucket_type_id, reason, tagged_by, tagged_at,
                expected_resolution_date, status=ACTIVE/RESOLVED, resolved_at, resolved_by)
exception_bucket_types (id, name, description, active)

follow_ups (id, invoice_id OR canonical_id, date, channel, contact_person,
            next_action_date, notes, logged_by, logged_at)

email_rules (id, type=DAILY_DIGEST/PUBLISH_NOTIF, recipients_json, schedule_cron, active)
email_log (id, rule_id, sent_at, recipients, subject, body_html, status)

audit_log (id, actor_id, action, entity_type, entity_id, before_json, after_json, ts)
```

**Key design calls:**
- `invoice_snapshots` is the append-only table driving trends. `invoices` holds the current truth.
- `raw_row_json` on invoices preserves exactly what came from Tally/Xero — non-negotiable for audit defence.
- Exception tags are on invoices, not snapshots — they persist across uploads as requested.

---

## 6. Source-file parsing notes (from the 3 samples)

**Tally `GrpBills.xlsx`:**
- Sheet `Sundry Debtors`. Metadata rows 0–4. Data starts row 5.
- Party name appears on its own row above invoices for that party; invoices follow with blank party cell. Parser must forward-fill party name.
- "Party sub-total" rows have blank Date/Ref — skip.
- `Overdue by days` is Tally's calc using Tally's due date → we ignore it and recompute using our credit period config.

**Xero `Aged Receivables Detail.xlsx`:**
- Sheet `Aged Receivables Detail`. Wide format, 23 cols. Header row 5.
- Columns we care about: Contact Account Number, Primary Person, Phone, Email, Invoice date, Reference, Due date, Total, Outstanding Tax, PROJECT ID, SERVICE MONTH, Invoice Seen, Invoice Sent.
- Per-party sub-totals and grand total rows must be skipped (prefix "Total ").
- Xero already has the `Invoice Seen` / `Invoice Sent` cols — we should ingest these into a separate `xero_invoice_metadata` table (or JSON blob on invoice) so the UAE dashboard can still show them.

**Credit Period config:**
- Two sheets: `India`, `UAE`. UAE has 4 cols (extra: Reason for extended, Amount). India has 2.
- Amount col in UAE sheet is currently unpopulated in sample — clarify what it represents (cap on extended terms? baseline?).

---

## 7. Phase 1 scope (MVP) vs phase 2

### Phase 1 (build now)
- India + UAE only
- Parsers for Tally GrpBills + Xero Aged Receivables
- All screens S1–S6, D1–D3, A1, A3, A5
- Snapshot + upsert pipeline
- 5-bucket ageing + exception persistence
- Daily CFO digest + publish notification emails
- Party alias master with fuzzy suggestions
- Follow-up log (structured)

### Phase 2 (after launch)
- Threshold breach alerts + exception expiry reminders
- Additional entities (when applicable)
- Direct Xero API pull (skip manual upload)
- Tally ODBC / direct pull
- DSO with sales data integration
- Customer portal (client sees own pending invoices)
- FX auto-pull from API
- Bulk follow-up from dashboard (send reminder email template with invoice list)

---

## 8. Downstream consequences / watch-outs

1. **Party alias master is a compounding asset.** Every unresolved alias today is friction forever. Design S4 so analysts never skip resolving — consider gating Publish on zero unresolved aliases above a confidence threshold.

2. **Exception tags survive snapshots — that's what you wanted, but it creates a reconciliation burden.** If an invoice is settled, exception must auto-resolve. If an invoice amount changes materially (partial payment, credit note), flag the exception for review. Without this, you'll have zombie exceptions piling up.

3. **Published snapshot is immutable.** If analyst discovers a mistake post-publish, they can't edit — they re-upload and republish. Consider whether you want a "correction" flow that amends without a full re-upload.

4. **Default credit period is load-bearing.** Unmapped parties silently get the default. Build a "Parties on default credit period" report so analysts can't forget to configure real ones. Consider a weekly reminder email listing these.

5. **Entity scoping for analysts** — UAE entity name in sample is `MANTARAV DIGITAL INFO...`. If EMB has multiple UAE legal entities, the entity scope may need to be more granular than India/UAE. Worth confirming now to avoid a schema migration.

6. **FX rate for consolidated view** — if CFO expects a single consolidated INR number and FX is wrong, they'll distrust the platform. Manual monthly entry is fine MVP, but tag every consolidated number with "as of FX rate dated X" to pre-empt this.

7. **Follow-up log will outgrow ageing as the headline feature.** Once analysts start using it, collections meetings move there, not to Tally. Plan for export-to-Excel of full follow-up log per party for client-facing escalation (legal, account manager).

8. **Tally "Overdue by days" vs our calc** — they WILL differ. Document this in the UI (tooltip: "Our overdue calc uses EMB credit period master, not Tally's due date. Tally's figure: X days, Ours: Y days"). Otherwise, first time analyst cross-checks, they'll lose trust.

9. **Audit trail storage growth** — snapshots every week across ~500 invoices per entity = ~1M rows/year in `invoice_snapshots`. Fine for Postgres, but plan partitioning by `as_of_date` early.

10. **Email digest deliverability** — daily 9 AM to CFO means `emb.global` SPF/DKIM needs to be right, and the `From:` address must be allowlisted. Get IT in the loop before first email goes out.

### New consequences from resolved answers (2026-04-16)

11. **FX is period-locked, not spot.** Fixing FX per FY/period means ageing comparisons across FY boundaries in the consolidated view will have a rate discontinuity. Design the `fx_rates` table with `valid_from` / `valid_to` and always apply the rate that matches the invoice's `invoice_date` (not upload date). Otherwise, re-running an old snapshot with a new FY rate will silently change historical consolidated numbers — CFO will notice and will not be happy. Lock the rule: **invoice_date determines FX rate, never changes once invoice is ingested.**

12. **FX rate change mid-FY.** If management decides to re-peg the rate mid-year (unlikely but possible), the design above means invoices before the re-peg keep old rate, new invoices get new rate. Consolidated trend will have a visible step. Build a small "FX rate changelog" view so this is explainable, not mysterious.

13. **Admin as publish-override creates a dual role.** Admin is now both platform operator AND a substitute analyst. This is fine for EMB's size but means audit log must clearly distinguish "published via override" from "published by assigned analyst". Add `published_as = 'OVERRIDE'` on the snapshot record so audit trail doesn't conflate.

14. **Google SSO + role assignment onboarding gap.** First-time login via SSO auto-creates a user with no role. They can log in but see nothing. Build an "awaiting role assignment" landing state + auto-notify admins on first login so they're not stranded. Consider a default role of `PENDING` with zero permissions.

15. **Digest at IST 9 AM in emails to UAE team.** UAE analyst (if one exists) gets the digest at 7:30 AM GST — before their workday starts. Fine for CFO (passive read), but if UAE analyst is expected to act on alerts, consider a second UAE-timed digest in phase 2.

16. ~~Amount column in UAE credit period sheet~~ — **Resolved 2026-04-16: ignored entirely. Parser drops the column.**

17. **"Current open only" first run means DSO isn't computable for ~3 months.** DSO needs trailing revenue + AR snapshots. Since trend history builds from week 1, CFO won't get meaningful DSO until Q1 of ingestion. Either mark DSO as "Available from [date]" in the UI, or skip the DSO KPI entirely for phase 1.

18. **Write-off tag with no JE trigger = risk of dashboard lying.** Analyst tags an invoice as "Written-off", it drops from headline AR. But Tally still has it as open AR. Month-end reconciliation between this dashboard's "reported AR" and Tally's balance sheet AR will have a gap equal to the write-off bucket total. Build a mandatory reconciliation view: `Dashboard AR + Exception buckets = Tally/Xero AR`. If they don't match, flag it. Without this, dashboard and Tally diverge silently and accounting will reject the numbers.

---

## 9. Resolved answers (2026-04-16)

| # | Question | Answer | Design impact |
|---|---|---|---|
| 1 | Auth | **Google Workspace SSO** (`@emb.global`) | OAuth2 via Google. No password management. Email auto-derives from SSO identity. Admin still needs to assign role + entity scope on first login. |
| 2 | UAE entity count | **One only (MANTARAV)** | Schema stays `entities` table with 2 rows (IND, UAE) for phase 1. Single entity per country assumption is safe. |
| 3 | `Amount` col in UAE credit period sheet | **Ignore — not meaningful** | Parser drops this column entirely. Not surfaced in UI. Not stored. |
| 4 | Digest timezone | **IST only** | Single scheduled job at 9 AM IST. Email body shows both INR and AED (converted) figures. UAE stakeholders get it at 7:30 AM GST — still workable. |
| 5 | Publish override | **Yes, Admin can override** | Admin role gets publish rights in addition to analyst. Add `can_override_publish = TRUE` on Admin role. CFO stays strictly read-only. |
| 6 | First-run historical depth | **Current open only** | No backfill. First snapshot = first upload. Trend chart starts building from week 1. Document this so CFO doesn't expect 12-week history on day 1. |
| 7 | Currency display | **Native AED on UAE dashboard; INR on consolidated. FX fixed per FY/period in backend config** | Add `fx_rates` table keyed by `(from_ccy, to_ccy, valid_from, valid_to)`. Admin sets it. Every INR figure is stamped with the FX rate + effective period used, visible on hover. |
| 8 | Write-off bucket | **Dashboard classification only, no JE trigger** | Tagging is a UI-only action. Accounting JE is out of scope. Add tooltip on the bucket: "This is a reporting tag only. Book the write-off entry in Tally separately." |

All 8 resolved. No remaining open questions.

---

## 10. Next steps (proposed)

1. You review this doc, resolve open questions above.
2. I write the data model SQL + API contract (endpoint list with request/response shapes).
3. I write the two parsers (Tally GrpBills + Xero Aged Receivables) with unit tests against the sample files you've shared — this de-risks the messy parts first.
4. Decide on hosting (on-prem EMB server? AWS? Render/Railway for MVP?) — affects deployment plan.
5. Wireframe review of S1, S2, D1 before UI code.
