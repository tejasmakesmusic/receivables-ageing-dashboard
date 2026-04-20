# Frontend gap closure — design spec

**Date:** 2026-04-20
**Status:** Approved (brainstorming → writing-plans)
**Owner:** Tejaswa Sharma
**Predecessor:** `2026-04-16-m1-foundations-design.md`
**Locked spec:** `02_HANDOFF_SPEC.md` (D1–D23 + §13 consequences)
**Wireframes:** `wireframes/` (S1, S2, D1, S5, A6 — approved 2026-04-18)

---

## 1. Background

The vertical-slice React frontend (16 pages, 58 vitest cases, shipped through M5/M6-full on 2026-04-19) has accumulated four classes of gap visible to the end user:

1. **Bugs** that make the app look broken — a duplicate `IND` option in the S3 entity dropdown, a broken link on the D1 default-credit-period banner pointing to `/credit-period` instead of `/config/credit-period`, and the S6 Follow-ups page being unreachable from the sidebar nav despite being routed.
2. **A missing browse-all entry point.** There is no top-level workspace listing every uploaded snapshot. Today, invoices are reachable only via party drill-down (`/party/:id`) or by typing a staging URL directly. The S1 Upload page's "Recent uploads" table is entity-scoped and capped at 10 rows.
3. **Wireframe vs React drift.** The 5 wireframes approved on 2026-04-18 contain components, badges, columns, and tooltips that the M4-MVP "vertical slice" pass dropped and M5/M6-full never restored. Examples: S2 staging credit-source badges, D1 `Tally X / Ours Y` dual-display (spec §13 #4 trust-critical), S5 bucket-card ₹ totals, A6 inline KPI explanations.
4. **Stub-quality non-wireframed pages.** Eleven of the 16 pages were built without wireframes from the spec alone. Of those eleven, three are auxiliary (Login, Pending, NotFound) and rightly minimal; one (S3 Credit Period) is already rich aside from bug #1; one (S6 Follow-ups) is already rich; and seven (D2, D3, S4, A2, A3, A4, A5) are functional but visually bare — tables + skeletons + filter bars with little hierarchy or context, no rich drill-throughs. This spec addresses the seven.

This spec covers all four classes in a single coordinated pass so the frontend reaches presentable parity with the spec + wireframes before the M8 production cutover.

## 2. Goals

1. Fix the three reported bugs (S3 dropdown, D1 link, S6 nav).
2. Ship a `/snapshots` Workspace page + `/snapshots/:id/invoices` sub-route as the canonical "browse all uploads" entry point.
3. Close every functional or informational deviation between the 5 wireframes (S1, S2, D1, S5, A6) and their React implementations. Cosmetic spacing nits are out of scope.
4. Promote the 7 stub-quality non-wireframed pages (D2, D3, S4, A2, A3, A4, A5) to rich layouts using the inline mockups in §6 of this document as the source of visual truth.

## 3. Non-goals

- New auth, RBAC, models, or business-logic decisions. RBAC follows existing patterns: ANALYST + ADMIN write entity-scoped, CFO read-only, PENDING 403. ADMIN-only mutations are flagged inline.
- Visual rebrand or design-system overhaul. All new components reuse the 9 existing UI primitives (`Button`, `Badge`, `Card`, `Input`, `Textarea`, `Select`, `Skeleton`, `Modal`, `Pagination`).
- New `wireframes/*.html` files for the 7 non-wireframed pages. The inline mockups in §6 are authoritative; if a future round of stakeholder review requires HTML wireframes, that is a separate task.
- Backfilling features beyond what the spec or wireframes already imply. No speculative additions.
- Backend behaviour changes beyond the minimum read-side aggregates and one ADMIN-only canonical-merge mutation needed to surface data the design requires.

## 4. Bug fixes

| # | File | Change | Reason |
|---|---|---|---|
| 1 | `frontend/src/pages/S3CreditPeriodPage.tsx:391` | `<option value="">IND</option>` → `<option value="">All</option>` | Placeholder option label was wrong, producing the duplicate `IND` shown in the user screenshot. |
| 2 | `frontend/src/pages/D1DashboardPage.tsx:392` | `to="/credit-period"` → `to="/config/credit-period"` | Target route does not exist; clicking the banner today produces a 404. |
| 3 | `frontend/src/components/Shell.tsx` (NAV_LINKS array) | Add `{ to: "/follow-ups", label: "Follow-ups", roles: ["ANALYST","ADMIN"] }` between Exceptions and Admin. Add `{ to: "/snapshots", label: "Workspace", roles: ["ANALYST","CFO","ADMIN"] }` between Upload and Dashboard. | S6 page is built and routed but unreachable from the sidebar. Workspace is the new §5 entry point. |

## 5. Workspace — `/snapshots`

### 5.1 Purpose

Single canonical place to see every snapshot uploaded across both entities and any status, with a drill-through to the invoices contained in any PUBLISHED snapshot. Replaces the entity-scoped 10-row "Recent uploads" table on S1 as the long-form browse view.

### 5.2 Routes

- `/snapshots` — list page. ANALYST + CFO + ADMIN. PENDING 403 via existing `ProtectedRoute`.
- `/snapshots/:id/invoices` — sub-route showing invoices for one PUBLISHED snapshot. Same RBAC. CP-source snapshots show an explanatory empty state because they generate no `invoice_snapshots` rows (ADR-0005).

### 5.3 List page layout

Single-column full-width table.

**Filter bar:** Entity multi-select (IND/UAE), Source multi-select (TALLY/XERO/CP), Status multi-select (PARSING/STAGED/PUBLISHED/DISCARDED), Date range picker on `as_of_date`. Filters URL-synced via query params.

**Columns:**
1. As-of date (`as_of_date`, IST formatted)
2. Entity (badge: IND/UAE)
3. Source (badge: TALLY/XERO/CP)
4. Status (color-coded badge)
5. Row count (integer; em-dash for CP)
6. Outstanding ₹ (formatted Indian Crore/Lakh; PUBLISHED only — em-dash otherwise)
7. Uploaded by (`uploaded_by_email`)
8. Uploaded at (relative IST: "2 hr ago", tooltip with absolute timestamp)
9. Action button — context-sensitive: STAGED → "Review staging" (links to `/staging/:id`); PUBLISHED → "View invoices" (links to `/snapshots/:id/invoices`); CP PUBLISHED → "View config" (links to `/config/credit-period?snapshot_id=:id`); DISCARDED → "View details" (read-only modal); PARSING → spinner + "Parsing…"

**Pagination:** 25 per page, reuse existing `Pagination` primitive.

**Empty state:** "No snapshots yet — upload one from /upload." Centered, with a primary-button link.

### 5.4 Sub-route layout (`/snapshots/:id/invoices`)

Header card: snapshot metadata (entity, source, as-of, status, uploaded by + at, total outstanding).

Filter bar: party search input (debounced 300ms), bucket multi-select (NOT_DUE/0_30/31_60/61_90/90_PLUS), credit-days source multi-select (config/default/manual).

Table columns: party (links to `/party/:canonical_id`), invoice ref, invoice date, due date, days overdue, bucket badge, outstanding ₹, exception tags (badges, links to S5 filtered to that party).

Rows clickable → `/invoice/:id` (existing detail page).

Pagination 50/page.

Empty states:
- CP snapshot: "Credit-period imports don't generate invoice rows. View the credit-period config at /config/credit-period."
- PUBLISHED snapshot with zero rows: should not happen; if it does, "No invoices in this snapshot."
- 404: snapshot id does not exist or user lacks entity access.

### 5.5 Backend

Reuse existing endpoints:
- `GET /snapshots` — confirm response includes `entity`, `source_hint`, `status`, `as_of_date`, `row_count`, `uploaded_by_email`. If `uploaded_by_email` not in `SnapshotListRow` schema, add it (the `created_by_user_id` FK already populates this).
- `GET /invoices?snapshot_id=&page=&...` — confirm endpoint supports filtering. Extend if missing.

Add one read-side aggregate:
- `SnapshotListRow.outstanding_total: Decimal | None` — sum of `invoice_snapshots.outstanding_amount` where `snapshot_id = X`. Computed inline in `snapshot_service.list_snapshots`. Null for non-PUBLISHED.

## 6. Wireframe-parity sweep (5 pages, 14 items)

### 6.1 S1 Upload

1. Add IND/UAE toggle button group inside the upload form (above source radio). Toggling updates `?entity=` URL param. Removes the "edit URL to change entity" hidden affordance.
2. Add `Uploaded by` column to the recent uploads table (uses existing `uploaded_by_email`).
3. Surface PARSING status as a row state in recent uploads (currently filtered out). Spinner badge + disabled action.

### 6.2 S2 Staging

4. Add `config` (blue) / `default` (gray) / `manual` (purple) source badge in the credit-days column. `manual` badge has tooltip showing the reviewer email. Field: `InvoiceStagingRow.credit_days_source` — confirm in schema; backed by `publish_service._resolve_credit_days_for_invoice`.
5. Replace bulk "Ack all" warnings button with per-warning rows, each with its own `Acknowledge` button. Reuses existing ack endpoint per warning.
6. Add a collapsible `<details>` section above the staging grid for PARSE_ERROR rows showing the raw row JSON preview (currently mixed inline). Spec §3 + wireframe lines 106–152.

### 6.3 D1 Dashboard

7. `TallyOverdueCell` (line 354) shows `Tally X / Ours Y` dual display (currently Tally only). Spec §13 #4 — trust-critical on day 1. If Tally figure is missing, fall back to "Ours: Y · Tally: —".
8. KPI tile "Parties 90+ days" gains a sub-line "₹X.XX Cr at risk" (sum of outstanding for those parties).
9. KPI tile "% Overdue" gains a WoW delta: arrow + delta-percentage compared to prior snapshot (positive = bad, red; negative = good, green). Null on first snapshot.
10. Top-10 party table gains a `# Invoices` column.
11. 4 mini-tiles (W-4, W-3, W-2, Now) below the trend sparkline showing the AR figure for each.

### 6.4 S5 Exceptions

12. Bucket summary cards show `₹X.XX Cr outstanding` per bucket. Requires `ExceptionListRow.outstanding_amount` (see §8.1). Cards remain clickable → filter to bucket.
13. Material-change banner shows unconditionally when there are material changes for the latest snapshot, regardless of whether `?snapshot_id=` is in the URL. Currently scoped only to snapshot-linked navigation.
14. Add the explainer banner ("Exceptions are persistent classifications; follow-ups are time-bound actions. See /follow-ups for tracking.") at the top of the page per wireframe lines 114–121. Dismissible per session via `localStorage`.

### 6.5 A6 Reconciliation

15. Add inline explanatory copy under each of the 4 KPI tiles (e.g., "Sum of open invoice outstanding for Snapshot #X. N invoices."). Copy text spec'd in wireframe.
16. Surface a publish-gate warning banner ("Publish of next snapshot blocked until MATCHED") with an admin-override button when reconciliation status is MISMATCHED. ADMIN sees override; ANALYST/CFO see the warning without action.

## 7. Inline-designed pages (7 pages)

These pages have no wireframes. The mockups below are the source of visual truth.

### 7.1 D2 Party Detail

**Header card:** party name + entity badge + active-exceptions count badge. Aliases sub-line. Credit period sub-line: `45 days [config]` with tooltip showing source + last-set date.

**Three-tile KPI row:** Exposure (₹ open total + invoice count), Ageing split (mini stacked bar showing the 5 buckets), FX (only for UAE parties — AED→INR rate as of latest snapshot per spec D15).

**Tabbed content:**
- Tab 1 — **Invoices** (existing sortable table — keep as-is).
- Tab 2 — **Follow-up timeline** (NEW). Vertical timeline. Each entry: dot icon, date, channel badge (EMAIL/CALL/MEETING/OTHER), actor email, note text. Reverse-chronological. Empty state: "No follow-ups logged for this party."
- Tab 3 — **Exceptions** (NEW). Table of active exceptions across all invoices for this party: invoice ref, exception type, status, reason, expected resolution. Each row links to S5 filtered to that exception.

**Backend:**
- Reuse `GET /parties/:id` (existing).
- New / extend: `GET /follow-ups?party_id=:id`. If endpoint already filters by party, no change.
- New / extend: `GET /exceptions?party_id=:id`. Same.

### 7.2 D3 Invoice Detail

Existing lineage cards stay.

**Add three sections below existing content:**

1. **Raw row** — collapsible `<details>` element. Renders the original parsed JSON from `invoice_snapshots.raw_row` in a monospace code block. "Copy to clipboard" button.
2. **Snapshot history** — read-only timeline of every `invoice_snapshots` row across all snapshots for this invoice. Columns: as-of date, snapshot id (link), outstanding, days overdue, bucket badge, source badge. Most recent first. Shows how the invoice ages over time.
3. **Related** — two-column panel. Left: linked exceptions (badge + reason + status, link to S5). Right: linked follow-ups (channel + date + actor, link to S6 entry).

**Backend:**
- New: `GET /invoices/:id/snapshot-history` — returns `invoice_snapshots` rows for this invoice ordered by `as_of_date DESC`.
- Reuse `GET /exceptions?invoice_id=` and `GET /follow-ups?invoice_id=` if they exist; extend filters if not.

### 7.3 S4 Aliases

**Confidence badges on alias rows:**
- `EXACT` (gray) — `match_type = exact`.
- `HIGH ≥90%` (green) — fuzzy 90+.
- `MED 70–89%` (yellow) — fuzzy 70–89.
- `LOW <70%` (red) — fuzzy below threshold; should not appear in committed aliases but may surface in pending review.

**Merge aliases action** (ADMIN only):
- Toolbar button "Merge canonicals" opens modal.
- Modal: two `Select` dropdowns (source canonical, target canonical) + reason textarea (required, ≥10 chars).
- On confirm → `POST /admin/canonicals/merge` with `{ source_canonical_id, target_canonical_id, reason }`.
- Backend in single transaction: move `party_aliases.canonical_id` source → target; move `credit_period_config.canonical_id` source → target; delete source canonical row; write `audit_log` row with `action='CANONICAL_MERGE'`, before/after JSON. Same pattern as the 2026-04-19 IND CP rescue documented in `CLAUDE.md` ops log.
- 200 → success toast + table refresh. 409 if any FK still references source.

### 7.4 A2 Email Outbox

Two stacked sections.

**Section 1 — Outbox queue** (existing). Improvements:
- Timestamps human-readable with absolute on hover.
- "Resend" button on FAILED rows (ADMIN). Confirms via modal; logs to audit; resets row status to QUEUED.

**Section 2 — Email rules** (NEW). Card grid. Each card per rule (Daily CFO digest, Snapshot publish notification, etc.):
- Rule name + description
- Schedule: cron expression + plain-English ("Daily at 09:00 IST")
- Last fired: timestamp + status badge (sent / failed / skipped)
- Next fire: computed from cron
- Enable/disable toggle (ADMIN only; writes `audit_log`)

**Backend:** `GET /admin/email-rules` — returns rules + last-fired metadata. `PATCH /admin/email-rules/:id` for enable/disable. The `email_rule` table already exists (`backend/src/app/db/models/email_rule.py` + `backend/src/app/schemas/email_rule.py`); this spec adds the read + toggle endpoints over it. Cron schedule fields are read from the existing scheduler service.

### 7.5 A3 Exception Buckets

Existing CRUD table stays. Add one column: **Preview**. Shows a non-interactive sample of how the bucket renders in S5 — its badge with configured color + label, exactly as it appears on S5 cards. Lets admins see visual impact before saving a new bucket.

No new endpoint needed; render uses bucket's color + label fields already returned by existing API.

### 7.6 A4 FX Rates

Two-pane layout.

**Left pane:** existing "Add new rate" form with the existing immutability warning banner. Keep as-is.

**Right pane:** chronological timeline for the selected currency pair.
- Currency-pair selector at top (defaults to AED→INR).
- Line chart of rate vs effective_date (SVG, no chart library — reuse the inline SVG pattern from D1's `TrendSparkline`).
- Below the chart: full table of every entry — effective_date, rate, added_by, added_at. Most recent first. Reinforces D15 (immutability) by making history visible.

**Backend:** existing `GET /admin/fx-rates?currency_pair=` already returns full history. No change.

### 7.7 A5 Audit Log

Four improvements:

1. **Action filter dropdown.** Replace free-text input with a `Select` populated by distinct values from `audit_log.action` (PUBLISH_SNAPSHOT, DISCARD_SNAPSHOT, CREATE_EXCEPTION, CANONICAL_MERGE, CREDIT_DAYS_BACKFILL, …). Multi-select.
2. **Actor filter dropdown.** Same pattern, populated by distinct `actor_email`.
3. **Diff highlighting in before/after JSON modal.** Side-by-side `<pre>` blocks. Hand-rolled key-by-key diff (no new dep): unchanged keys gray; removed keys red strikethrough on left, absent on right; added keys absent on left, green on right; changed values yellow background, both sides. Falls back to plain `<pre>` if either side is non-object.
4. Date range filter (`occurred_at` from/to).

**Backend:** add `GET /admin/audit-log/actions` returning `[{action: str, count: int}]`; `GET /admin/audit-log/actors` returning `[{actor_email: str, count: int}]`. Existing `GET /admin/audit-log` stays; extend with `actions[]`, `actors[]`, `from_date`, `to_date` query params if not already supported.

## 8. Schema and API additions (consolidated)

### 8.1 Pydantic schema additions

| Schema | Field | Type | Used by |
|---|---|---|---|
| `ExceptionListRow` | `outstanding_amount` | `Decimal` | S5 bucket cards (§6.4 #12) |
| `SnapshotListRow` | `uploaded_by_email` | `str` | S1, Workspace |
| `SnapshotListRow` | `outstanding_total` | `Decimal \| None` | Workspace (§5.5) |

### 8.2 New endpoints

| Method | Path | RBAC | Purpose |
|---|---|---|---|
| `GET` | `/invoices/:id/snapshot-history` | ANALYST/CFO/ADMIN | D3 snapshot history (§7.2) |
| `GET` | `/admin/email-rules` | ADMIN | A2 rules section (§7.4) |
| `PATCH` | `/admin/email-rules/:id` | ADMIN | A2 enable/disable (§7.4) |
| `POST` | `/admin/canonicals/merge` | ADMIN | S4 merge action (§7.3) |
| `GET` | `/admin/audit-log/actions` | ADMIN | A5 action dropdown (§7.7) |
| `GET` | `/admin/audit-log/actors` | ADMIN | A5 actor dropdown (§7.7) |

### 8.3 Existing endpoints to extend (filter params)

- `GET /invoices` — confirm `snapshot_id`, `bucket[]`, `credit_days_source[]`, `party_query` filters.
- `GET /exceptions` — confirm `party_id`, `invoice_id` filters.
- `GET /follow-ups` — confirm `party_id`, `invoice_id` filters.
- `GET /admin/audit-log` — confirm `actions[]`, `actors[]`, `from_date`, `to_date` filters.

If any filter is missing, add it. Filter additions are backwards-compatible.

### 8.4 No new database models or migrations

All additions are read-side aggregates, schema fields backed by existing columns, or new endpoints over existing tables. The only mutation endpoint (`POST /admin/canonicals/merge`) operates on existing tables (`party_aliases`, `credit_period_config`, `parties_canonical`, `audit_log`).

## 9. Error handling

- **Workspace empty state:** "No snapshots yet — upload one from /upload."
- **Workspace sub-route 404:** snapshot id does not exist or user lacks entity-scoped access.
- **CP-snapshot sub-route empty state:** "Credit-period imports don't generate invoice rows. View the credit-period config at /config/credit-period."
- **Canonical merge 409:** "Cannot merge — N rows still reference source canonical. Re-point or delete first."
- **A2 Resend FAILED:** confirm modal; success toast; on second failure surface the parser/SMTP error.
- **A4 immutability error:** banner above form (matches existing pattern), not toast.
- **All new endpoints:** standard 401/403/404 + structured error envelope per existing pattern.

## 10. Testing

### 10.1 Frontend (vitest)

Estimated +50 cases:
- 3 bug fix regressions (S3 dropdown options, D1 link target, Shell nav contains Workspace + Follow-ups).
- Workspace list page (filter URL sync, status badge rendering, empty state, pagination, action button context).
- Workspace sub-route (header card, filter bar, drill-through to invoice detail, CP empty state).
- 14 wireframe-parity items — one assertion each for component / column / badge presence.
- D2: tab switch, follow-up timeline ordering, exception tab navigation.
- D3: raw-row collapse/expand, snapshot history table sort, related panel rendering.
- S4: confidence badge color mapping, merge modal opens / submits / closes on success.
- A2: rules card rendering, enable/disable toggle, resend modal flow.
- A3: preview column renders with bucket color + label.
- A4: timeline chart renders, table sort by effective_date.
- A5: action dropdown populates, diff highlights changed/added/removed keys.

### 10.2 Backend (pytest)

Estimated +15 cases:
- `outstanding_amount` aggregate on `ExceptionListRow` — sums correctly across active exceptions of a bucket.
- `outstanding_total` aggregate on `SnapshotListRow` — null for non-PUBLISHED, correct for PUBLISHED.
- `GET /invoices/:id/snapshot-history` — orders by `as_of_date DESC`, RBAC, 404.
- `GET /admin/email-rules` and `PATCH` — ADMIN-only, audit log row written on toggle.
- `POST /admin/canonicals/merge` — happy path moves aliases + CP rows + deletes source + writes audit; 409 on dangling FK; 403 for non-ADMIN.
- `GET /admin/audit-log/actions` and `/actors` — distinct values, count correct.
- Audit-log filter extensions (`actions[]`, `actors[]`, date range) — combined filter behavior.

### 10.3 No skipped or xfailed tests added.

Per `CLAUDE.md`: every change ships with tests. Parser tests run against the 3 sample files in `backend/tests/fixtures/sample_files/` if any parser code is touched (none expected in this spec).

## 11. Acceptance criteria

1. Screenshot of S3 entity dropdown shows `All / IND / UAE` (no duplicate `IND`).
2. Sidebar nav contains "Workspace" between Upload and Dashboard, "Follow-ups" between Exceptions and Admin. Clicking the D1 default-credit-period banner lands on `/config/credit-period`.
3. `/snapshots` lists every snapshot across IND + UAE, filterable by entity / source / status / date range. Action button context is correct for each status. Clicking "View invoices" on a PUBLISHED snapshot lands on `/snapshots/:id/invoices` and lists its invoices with bucket badges + outstanding ₹. Each invoice row links to `/invoice/:id`.
4. All 14 wireframe-parity items in §6 are visible on their respective pages.
5. D2 has Invoices + Follow-up timeline + Exceptions tabs. D3 has Raw row + Snapshot history + Related sections. S4 has confidence badges + Merge canonicals action. A2 has Outbox queue + Email rules sections. A3 has Preview column. A4 has timeline chart + table. A5 has action dropdown, actor dropdown, date range filter, and diff-highlighted before/after modal.
6. All existing tests stay green. New tests pass.
7. No regression in existing flows: upload → stage → publish → dashboard → exception → reconciliation continues to work end-to-end.

## 12. Out of scope (explicitly deferred)

- New `wireframes/*.html` files for the 7 inline-designed pages. The §7 mockups are authoritative.
- Any visual rebrand, design token changes, or design system overhaul.
- Backend behaviour changes beyond §8.
- M8 production cutover items (DNS, Railway Pro, Google OAuth client, first live snapshot).
- Deferred items from `PROGRESS.md § Known gaps` not listed above (M1 mypy cleanup, AGENTS.md commit decision, etc.).

## 13. Effort estimate

| Phase | Estimate |
|---|---|
| Bug fixes (§4) | 30 min |
| Workspace (§5) | 4–6 hr |
| Wireframe-parity sweep (§6) | 6–8 hr |
| 7 inline-designed pages (§7) | 2–3 days |
| **Total** | **~3–4 working days at Sonnet pace, parallelizable across multiple agents per page.** |

## 14. Open questions

None. All design decisions are resolved in this document. If implementation surfaces a contradiction with `02_HANDOFF_SPEC.md`, the spec wins per `CLAUDE.md` source-of-truth rule.
