# Receivables OS Design

- Date: 2026-05-01
- Status: Refined design (post-research). Pending Tejaswa's final review
  before implementation begins.
- Companion research: `docs/superpowers/research/2026-05-01-receivables-os-research.md`
- Implementation plan: `docs/superpowers/plans/2026-05-01-receivables-os-implementation-plan.md`

## Approvals — Locked 2026-05-01

The following four decisions were confirmed by Tejaswa on 2026-05-01 and
are no longer open for re-litigation inside this iteration:

1. **Alembic → Prisma migration cutover** — full cutover, recorded via
   the planned ADR-0008. Phase 2 freezes Alembic; all future schema
   changes use `prisma migrate deploy` against `DATABASE_URL_DIRECT`.
2. **DSO surface** — labelled "DSO (issuance-based)" with a caveat
   banner on every surface. Plain "DSO" is not used in CFO copy. CEI
   stays hidden.
3. **CFO comments** — out of scope. CFO Review remains strictly
   read-only. D5/D17 unchanged.
4. **Audit log granularity for suggest_batch** — one summary row per
   publish (`collection_task.suggest_batch`) with summary JSON
   (`snapshot_id`, total count, breakdown by `reason_code`). Per-task
   evidence is reconstructable from `collection_tasks.created_at` plus
   `source_snapshot_id`. No per-task audit row at generation.

## Context

The locked functional source remains `02_HANDOFF_SPEC.md`; this document
does not modify it. The current ADRs in `docs/adr/` move the runtime to
Next.js 16, React 19, TypeScript, Prisma 7 with `@prisma/adapter-neon`
(and `@prisma/adapter-pg` for local), Neon PostgreSQL, Tailwind CSS 4,
local shadcn-style primitives, ExcelJS, SheetJS, Fuse.js, Recharts, and
Vercel.

This design turns the current Receivables Ageing Dashboard into an internal
**Receivables OS**: an Order-to-Cash / Accounts Receivable control platform
for monthly AR close, collections execution, CFO review, and governance.

Naming uses accounting-grade terminology in CFO and audit-facing surfaces
(*Aged Trial Balance*, *Subledger Tie-Out*, *AR Roll-Forward*) and operator
terminology in working surfaces (*Collections Workbench*, *Promise to
Pay*, *Dispute Case*).

## Product Thesis

Build a role-based AR command center over one shared data backbone:

- **Analysts** operate the close and collections workflow for their
  assigned entity.
- **CFO** users review all entities read-only, with emphasis on working
  capital, recoverability, risk, and movement.
- **Admin** users govern access, configuration, email rules, FX, publish
  overrides, and audit evidence.
- **Pending** users authenticate but see no AR data until approved.

The product feels like a finance operations CRM rather than a generic
dashboard. Party, Invoice, Snapshot, Control Exception, Collections
Activity, Collection Task, Promise to Pay, Dispute Case, Digest Event, and
Audit Log are first-class objects with views, filters, owners, statuses,
and history.

## Design References

The visual direction borrows product language from Twenty without copying
branding, assets, source code, or screenshots. We re-implement equivalent
ideas under our own neutral semantic tokens (see §6 Visual System).

Reference URLs (inspected; **not** imported):

- https://github.com/twentyhq/twenty
- https://twenty.com/twenty-ui/section/input/color-scheme
- https://docs.twenty.com/user-guide/settings/capabilities/experience-settings

Finance terminology grounded in Order-to-Cash, AR metrics, internal
control, and trade-receivables impairment language:

- Order-to-Cash / Invoice-to-Cash (we are I2C-only)
- Accounts receivable subledger and source-system tie-out
- Aged trial balance
- DSO, Best Possible DSO, AR Turnover, ageing migration
- Dunning, Promise to Pay, Dispute Case
- IFRS 9 ECL evidence pack (not provision matrix)
- COSO-style control evidence and monitoring

## Naming — Locked For This Iteration

These names are settled here and used consistently across nav, headings,
columns, and tooltips. See §15 of the research doc for full rationale.

| Internal route                | Nav label                       | Page heading (h1)                        |
|--------------------------------|---------------------------------|------------------------------------------|
| `/dashboard`                   | AR Command Center               | AR Command Center                        |
| `/dashboard/consolidated`      | CFO Review                      | CFO Review                               |
| `/close`                       | AR Close & Certification        | AR Close & Certification                 |
| `/upload`                      | Snapshot Intake                 | Snapshot Intake                          |
| `/staging/:id`                 | Staging Controls                | Staging Controls                         |
| `/reconciliation`              | Subledger Tie-Out               | Subledger Tie-Out                        |
| `/collections`                 | Collections Workbench           | Collections Workbench                    |
| `/credit-risk`                 | Credit & Risk                   | Credit & Risk                            |
| `/party/:id`                   | Customer Ledger                 | Customer Ledger — &lt;party&gt;          |
| `/invoices`                    | Invoices                        | Invoices                                 |
| `/follow-ups`                  | Collections Activity            | Collections Activity                     |
| `/exceptions`                  | Control Exceptions              | Control Exceptions                       |
| `/reports`                     | Reports & Exports               | Reports & Exports                        |
| `/admin/users`                 | User Governance                 | User Governance                          |
| `/admin/fx-rates`              | FX Rates                        | FX Rates                                 |
| `/admin/email-rules`           | Email Rules                     | Email Rules                              |
| `/admin/audit-log`             | Audit Log                       | Audit Log                                |

Table column header conventions:

- **"Outstanding"** for unpaid balance (not "Amount").
- **"Days Overdue"** (not "Overdue Days").
- **"Bucket"** (short header) / "Ageing Bucket" (tooltip).
- **"As Of"** (short header) / "Snapshot As-Of Date" (tooltip).
- **"Owner"** for assigned user across Collection Task / Dispute Case /
  Follow-up / Promise to Pay.

## Navigation

Use a persistent app shell with a compact left navigation, global
command/search, role-aware entry screen, and right-side detail panels on
dense work pages.

Primary navigation (role-filtered):

- AR Command Center
- AR Close & Certification
- Collections Workbench
- Credit & Risk
- Customer Ledger
- Invoices
- CFO Review
- Reports & Exports
- Controls & Governance (Admin only)

Role-specific landing behaviour:

- **Analyst:** close blockers, action urgency queue, owned promises,
  disputes, and stale follow-ups.
- **CFO:** net AR exposure, overdue AR, 90+ concentration, DSO movement
  (issuance-based; see §7), ageing migration, unresolved disputes, and
  close certification status.
- **Admin:** pending users, configuration drift, email rule state, audit
  anomalies, FX coverage, and publish override history.
- **Pending:** waiting screen only.

## Visual System

Implement with Tailwind CSS 4 (`@theme` design tokens) and local
shadcn-style primitives. Class-based dark mode driven by `next-themes`.

### Foundations

- **Spacing.** 4px base scale (1/2/3/4/5/6/8 → 4/8/12/16/20/24/32).
- **Radius.** 2/4/8 px small to medium; pill (9999) for status chips.
- **Table density.** 8 px cell padding, 32 px row height (default), 36 px
  for editable rows.
- **Typography.** Inter sans (already declared in `globals.css`). Sizes:
  xxs 10 px, xs 13 px, sm 14 px, md 16 px, lg 20 px, xl 24 px, xxl 30 px.
- **Borders.** Hairline (`--color-border`), strong (`--color-border-strong`).

### Semantic Color Tokens

Light theme:

| Token                  | Value      | Use                                 |
|------------------------|------------|-------------------------------------|
| `--color-bg`           | `#ffffff`  | App background                      |
| `--color-bg-subtle`    | `#fcfcfc`  | Sidebar, table header               |
| `--color-bg-muted`     | `#f1f1f1`  | Hover row, inactive surface         |
| `--color-border`       | `#ebebeb`  | Hairline border                     |
| `--color-border-strong`| `#d6d6d6`  | Card border, table border           |
| `--color-text`         | `#333333`  | Primary text                        |
| `--color-text-muted`   | `#666666`  | Secondary text                      |
| `--color-text-subtle`  | `#999999`  | Tertiary / placeholder              |
| `--color-accent`       | `#465fd6`  | Selected nav, primary action        |
| `--color-accent-soft`  | `#eef2fd`  | Active nav background               |
| `--color-success-soft` | `#e9f7ee`  | Status: positive                    |
| `--color-warning-soft` | `#fff6db`  | Status: warning                     |
| `--color-danger-soft`  | `#fbecec`  | Status: negative                    |

Dark theme:

| Token                  | Value      | Use                                 |
|------------------------|------------|-------------------------------------|
| `--color-bg`           | `#171717`  | App background                      |
| `--color-bg-subtle`    | `#1b1b1b`  | Sidebar, table header               |
| `--color-bg-muted`     | `#1d1d1d`  | Hover row, inactive surface         |
| `--color-border`       | `#222222`  | Hairline border                     |
| `--color-border-strong`| `#333333`  | Card border, table border           |
| `--color-text`         | `#ebebeb`  | Primary text                        |
| `--color-text-muted`   | `#b3b3b3`  | Secondary text                      |
| `--color-text-subtle`  | `#888888`  | Tertiary / placeholder              |
| `--color-accent`       | `#5f72d6`  | Selected nav, primary action        |
| `--color-accent-soft`  | `#1b2446`  | Active nav background               |
| `--color-success-soft` | `#193123`  | Status: positive                    |
| `--color-warning-soft` | `#352b16`  | Status: warning                     |
| `--color-danger-soft`  | `#351d1d`  | Status: negative                    |

### Ageing-bucket status tones

The bucket signal must remain readable across both themes. Use a fixed
chip palette that overrides surface tone:

| Bucket     | Light fill           | Dark fill           | Text token       |
|------------|----------------------|---------------------|------------------|
| Not Due    | `#f1f1f1` (muted)    | `#1d1d1d` (muted)   | `text`           |
| 0–30       | `--color-accent-soft`| `--color-accent-soft`| `accent`        |
| 31–60      | `--color-warning-soft`| `--color-warning-soft`| `text`         |
| 61–90      | `#ffe1c2`            | `#3a2a14`           | `text`           |
| 90+        | `--color-danger-soft`| `--color-danger-soft`| `text`          |

### Tailwind CSS 4 wiring

`src/app/globals.css` will declare both themes using `@theme` and a
`@custom-variant` for class-based dark mode. Detailed code in the
implementation plan.

### Interface patterns

- Avoid marketing-style hero layouts.
- Prefer tables, filters, segmented views, compact KPIs, and side panels.
- Use icon buttons with tooltips for repeated actions.
- Use cards only for repeated records, modals, and framed tools.
- Keep charts restrained and decision-oriented.
- Light, Dark, and System are stored as user experience preferences and
  driven by `next-themes` (`attribute="class"`,
  `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`).

## Core Workflow

The product follows a close-to-collections operating loop:

1. **Snapshot Intake.** Upload Tally, Xero, and credit-period workbooks.
   Detect source, parse rows, stage parser errors, record source file
   evidence.
2. **Staging Controls.** Resolve parser errors, party aliases, fuzzy
   matches, credit days, validation warnings, and material issues before
   publish.
3. **Subledger Tie-Out.** Analyst enters source-system closing AR for the
   snapshot. The app compares dashboard AR plus exception bucket effects
   against source AR.
4. **Close Certification.** Publish only after guardrails pass. Publish
   creates the trusted snapshot basis for dashboards, reports, and
   collection task generation.
5. **Collections Execution.** Suggested tasks are created from published
   snapshot data, follow-up activity, disputes, promises, and risk
   signals.
6. **CFO Review.** CFO sees read-only working capital exposure, movement,
   operational risk, and control evidence.

## Operational Objects

### Existing backbone records (no schema change)

- Entity, User, Snapshot, Staged Invoice (in `staging_overrides_json`),
  Party / Canonical Party, Party Alias, Invoice, Invoice Snapshot,
  Exception Tag (Control Exception), Follow-up (rendered as Collections
  Activity), Reconciliation Entry, Credit Period Config, FX Rate, Email
  Rule, Email Outbox, Audit Log.

### New stored objects

#### Collection Task

Operational work item for collections and risk follow-up. Suggested by
the publish pipeline; created manually by analysts in scope.

Key fields:

- `id`, `entity_id`, `canonical_id`, `invoice_id` (nullable),
  `source_snapshot_id`
- `source_type`: `SUGGESTED` | `MANUAL`
- `reason_code`: `NINETY_PLUS` | `STALE_FOLLOW_UP` | `HIGH_VALUE` |
  `DISPUTE_OPEN` | `BROKEN_PROMISE` | `MANUAL`
- `priority_score` (numeric)
- `status`: `SUGGESTED` | `OPEN` | `IN_PROGRESS` | `SNOOZED` | `DONE` |
  `DISMISSED`
- `owner_user_id` (nullable; null means unassigned)
- `due_date` (nullable)
- `completed_at`, `dismissed_reason`, `created_by`, `created_at`,
  `updated_at`

Every create, reassignment, status change, snooze, dismissal, and
completion writes an `audit_log` row with before/after JSON.

#### Collections Activity

Product label for structured AR activity. The existing `follow_ups` table
backs this object. The interface frames it as Collections Activity.
Activity types:

- Email, Call, WhatsApp, Meeting
- Task status change, Owner reassignment, Promise to Pay update, Dispute
  update (synthesised from the corresponding object's audit log; not
  stored twice)

Linked to a party, optionally to an invoice and collection task.

#### Promise to Pay

Customer commitment tracking, independent of free-text notes.

Key fields:

- `id`, `canonical_id`, `invoice_id` (nullable), `collection_task_id`
  (nullable)
- `amount`, `currency`, `promised_date`
- `status`: `OPEN` | `KEPT` | `BROKEN` | `CANCELLED`
- `contact_person`, `notes`
- `created_by`, `created_at`, `updated_at`

State transitions:

- `OPEN → KEPT` on operator confirmation or when the invoice is no longer
  outstanding in the next published snapshot AND the disappearance is not
  flagged for review.
- `OPEN → BROKEN` when `promised_date < as_of_date` of the latest
  published snapshot AND the invoice is still outstanding.
- `OPEN → CANCELLED` on operator cancel with reason.

A *Broken* PTP can generate a Collection Task with
`reason_code = BROKEN_PROMISE` after the next published snapshot.

#### Dispute Case

Customer-facing receivable dispute, separate from parser errors and
control exceptions.

Key fields:

- `id`, `entity_id`, `canonical_id`, `invoice_id` (nullable)
- `reason_code` (e.g. `PRICE`, `QUANTITY`, `QUALITY`, `BILLING_ERROR`,
  `MISSING_PO`, `OTHER`)
- `description`, `status`: `OPEN` | `IN_REVIEW` | `WAITING_ON_CUSTOMER` |
  `RESOLVED` | `CLOSED`
- `owner_user_id`, `expected_resolution_date`, `resolved_at`,
  `resolution_note`
- `created_by`, `created_at`, `updated_at`

Visible in Collections Workbench, Credit & Risk, Customer Ledger detail,
Invoice detail, and CFO Review.

A Dispute Case is **not** the same as a `disputed by client` exception
tag. The exception tag is a tie-out classification for the
reconciliation; the Dispute Case is the operating record. Opening a
Dispute Case may trigger a `disputed by client` exception tag (Admin
controlled), but they are stored independently.

#### Digest Event

Auditable CFO digest lifecycle.

Key fields:

- `id`, `digest_date`
- `state`: `DRAFT` | `PREVIEWED` | `APPROVED` | `SENT` | `SKIPPED` |
  `FAILED`
- `snapshot_ids` (jsonb array), `payload_json`
- `approved_by`, `sent_at`, `error_message`, `created_at`, `updated_at`

The digest stays inactive until Tejaswa explicitly activates the email
rule. CFO cannot activate or send. The cron handler must:

1. Acquire a Postgres advisory lock keyed on `digest_date`.
2. Persist the Digest Event before sending.
3. Re-check `email_rules.is_active = true` inside the handler.
4. Be idempotent against retries (state transitions only forward).

### Object relationships

```
Party (canonical)
  ├── Invoice * ─────── Invoice Snapshot * (per published snapshot)
  ├── Follow-up *  (rendered as Collections Activity)
  ├── Promise to Pay *
  ├── Dispute Case *
  └── Collection Task *

Snapshot
  ├── Invoice (first_seen / settled refs)
  ├── Invoice Snapshot *
  ├── Reconciliation Entry (1:1)
  └── Collection Task * (suggested at publish)

Collection Task
  ├── Promise to Pay *  (a task may track one or more PTPs)
  ├── Dispute Case ?    (a task may surface an open dispute)
  └── Audit Log *

Audit Log
  └── any object mutation (before/after JSON)
```

### Derived views (not stored)

- **Risk Signals** — computed from snapshot + activity + dispute + PTP
  state.
- **Action Urgency Score** — derived from amount, ageing bucket, due
  date, dispute state, promise state, and stale contact.
- **DSO (issuance-based)** — countback from snapshot, treating invoice
  issuance as credit-sales proxy. Always shown with caveat banner.
- **Best Possible DSO** — current AR / issuance per period.
- **Ageing Migration** — flagship metric; per consecutive published
  snapshot.
- **ECL Evidence Pack** — ageing migration tables + dispute register +
  tie-out evidence. **Not** a provision number.

## Metrics — Supported / Partial / Future

This product is conservative about accounting claims.

| Metric                     | Status     | Where shown                        |
|---------------------------|------------|------------------------------------|
| DSO (countback)            | Partial    | CFO Review, Command Center (caveat)|
| DSO (simple)               | Hidden     | —                                  |
| CEI                        | Future     | Hidden until payment feed exists   |
| AR Turnover                | Partial    | CFO Review, secondary KPI (caveat) |
| Average Days Delinquent    | Partial    | Workbench analytics card (caveat)  |
| Best Possible DSO          | Supported  | CFO Review, paired with DSO        |
| Overdue AR / 90+ exposure  | Supported  | CFO Review, Command Center         |
| Customer Concentration     | Supported  | CFO Review, Credit & Risk          |
| Ageing Migration           | Supported  | CFO Review (flagship)              |
| Bad-Debt Watchlist         | Supported  | Credit & Risk (label clearly)      |
| IFRS 9 ECL Provision       | Hidden     | Never displayed                    |
| ECL Evidence Pack          | Partial    | Reports & Exports (export only)    |

A "Caveat banner" pattern prefixes any partial-status metric with:
"DSO (issuance-based) — based on invoice issuance as a credit-sales
proxy. Cash-side accuracy requires payment-receipts feed."

## RBAC

RBAC is enforced in route handlers, *not only* in UI. Page-level checks
exist as a defense-in-depth layer (the existing `src/server/core/page-auth.ts`)
but route handlers must independently validate.

### Role rules

**Analyst:**
- Assigned to one entity (`users.entity_id_scope`).
- Can upload, stage, reconcile, publish, and operate collection records
  for that entity.
- Can create follow-ups, collection tasks, promises, and disputes within
  scope.
- Cannot see or mutate another entity.
- Cannot manage users, global FX, global email rules, or cross-entity
  admin configuration.

**CFO:**
- Can read all entities.
- Can view dashboards, party detail, invoice detail, CFO Review, reports,
  digest previews, and control evidence.
- Cannot create, update, publish, approve, comment, send digest, or
  change configuration.
- CFO comments are out of scope (mutation forbidden).

**Admin:**
- Can govern all entities.
- Can approve Pending users, assign roles, set Analyst entity scope,
  insert FX rates, manage exception buckets, manage email rules, configure
  ownership defaults, and override publish with reason.
- Cannot mutate FX rows after creation (D15).
- Every Admin mutation is audited.

**Pending:**
- Can authenticate.
- Sees only the Pending page.
- Receives no AR data from pages, route handlers, APIs, exports, or
  background jobs. Route handlers must short-circuit before any database
  read.

### Route-level RBAC contract

Every route handler under `src/app/api/` must call:

1. `getCurrentUser()` (existing) → throws `UnauthorizedError` on
   missing/invalid session.
2. `requireRole(...allowedRoles)` (existing) for blanket allow lists.
3. `assertAnalystCanAccessEntity(user, entityId)` (existing) for any
   request that reads or mutates entity-scoped data.
4. `assertReadOnlyForCfo(user)` (new helper, §11) for any non-GET handler
   that an analyst-or-admin matrix would otherwise allow CFO into.
5. `assertNotPending(user)` (new helper, §11) at the very top of any
   handler that returns AR data — Pending must never reach a database
   query.

## CFO Review

Prioritise:

- Net AR exposure by entity and consolidated INR.
- Total overdue and 90+ concentration.
- Ageing migration since previous published snapshot (flagship).
- DSO trend (issuance-based, with caveat banner).
- Best Possible DSO paired with DSO.
- Top high-risk parties (concentration + watchlist).
- Open disputes and broken promises (counts only; CFO read-only).
- Close certification status and unresolved control exceptions.
- Digest preview and CFO pack export.

CFO Review can export approved reports but cannot mutate records. The
"export approved reports" path uses the same role checks (CFO is allowed
to *generate* the export but cannot save server-side state changes).

## Reports

- **Aged Trial Balance.** Per snapshot, by entity, with bucket totals
  and party drill-down.
- **AR Roll-Forward (snapshot-to-snapshot movement).** Labelled clearly
  that it lacks payment-side detail.
- **Collections Performance Report.** Counts of tasks, activities,
  promises kept/broken, disputes resolved.
- **Promise to Pay Report.**
- **Dispute Ageing Report.**
- **Collections Activity Export.**
- **CFO Pack.** Bundled CFO Review export.
- **ECL Evidence Pack.** Ageing migration + dispute register + tie-out;
  no provision number.
- **Audit Log Export** (Admin only).

Excel exports use ExcelJS. Imported workbook parsing remains SheetJS.

## Email And Digest

Email remains gated:

- Publish notifications are transactional and auditable.
- Daily CFO digest is prepared as a Digest Event.
- The digest rule is inactive until explicitly activated.
- Admin manages rule activation.
- CFO receives the digest but cannot activate or send it.

Digest timezone remains IST (D18).

Cron handler invariants — all four must hold or the handler aborts:

1. `email_rules.is_active = true` for `rule_type = 'CFO_DIGEST'` *and*
   for the entity's notification rule.
2. A new `Digest Event` row is persisted in `DRAFT` state before
   compiling payload.
3. Postgres advisory lock keyed on `digest_date` to serialise across
   replicas/retries.
4. Final state transition `APPROVED → SENT` only after SMTP success.

## Accounting Guardrails

The system **must not**:

- Create or post journal entries.
- Trigger write-offs.
- Auto-backfill historical data (D14).
- Mutate FX rows after creation (D15).
- Use wall-clock today for ageing.
- Use Tally `due_on` or `overdue_days` as the ageing source.
- Drop parser errors silently.
- Persist the UAE credit-period `Amount` column (D20).
- Send CFO emails before the rule is active (D13 + AGENTS.md).

The system **may**:

- Support ECL/provision-matrix evidence by ageing bucket.
- Surface write-off classification as a dashboard/exception tag.
- Export control evidence for accounting review.
- Track disputes, promises, and collection activity as operating records.

## Data Flow

Snapshot data flow (unchanged from the original spec):

1. Upload workbook.
2. Parse rows.
3. Stage valid rows and parser errors.
4. Resolve aliases, credit days, and warnings.
5. Reconcile AR tie-out.
6. Publish snapshot.
7. Generate suggested collection tasks.
8. Update dashboards, CFO Review, reports, and digest inputs.

Collections data flow:

1. Analyst opens Collections Workbench.
2. Filters by entity, owner, bucket, risk, dispute, promise, and next
   action.
3. Works a task from the table or right-side panel.
4. Logs activity, creates promise, opens dispute, snoozes, dismisses, or
   completes.
5. Mutation writes audit log.
6. CFO Review reflects progress read-only.

## Screen Map

(URLs unchanged from the existing app where present; new routes flagged.)

| Route                          | New?     | Purpose                                  |
|--------------------------------|----------|------------------------------------------|
| `/dashboard`                   | Existing | AR Command Center                        |
| `/dashboard/consolidated`      | New      | CFO-grade AR overview                    |
| `/close`                       | New      | AR Close & Certification entry           |
| `/upload`                      | Existing | Snapshot Intake                          |
| `/snapshots/[id]/staging`      | Existing | Staging Controls                         |
| `/reconciliation`              | New      | Subledger Tie-Out                        |
| `/collections`                 | New      | Collections Workbench                    |
| `/credit-risk`                 | New      | Credit & Risk                            |
| `/party/[canonical_id]`        | Existing | Customer Ledger                          |
| `/invoice/[invoice_id]`        | Existing | Invoice detail                           |
| `/follow-ups`                  | Existing | Collections Activity                     |
| `/exceptions`                  | Existing | Control Exceptions                       |
| `/reports`                     | New      | Reports & Exports                        |
| `/admin/users`                 | Existing | User governance                          |
| `/admin/fx-rates`              | New      | Immutable FX insert and history          |
| `/admin/email-rules`           | New      | Digest and publish notification rules    |
| `/admin/audit-log`             | Existing | Audit evidence                           |
| `/auth/pending`                | Existing | Pending landing page                     |

Existing route URLs are preserved. URL aliases or redirects are not in
scope.

## Testing And Verification

Backend / route-handler tests:

- RBAC matrix for Analyst, CFO, Admin, Pending — every route handler.
- Entity scoping in every list and detail route.
- Audit log written for every mutation with before/after JSON.
- Snapshot publish task generation.
- Collection Task lifecycle (suggest → open → in-progress → done /
  dismissed / snoozed).
- Promise to Pay lifecycle and snapshot-driven kept/broken transitions.
- Dispute Case lifecycle.
- Digest Event lifecycle and inactive-rule safety (must not send).
- FX immutability (update / delete forbidden).
- Ageing uses snapshot `as_of_date` (regression test against
  wall-clock today).
- CFO and Pending mutation-block tests for every mutating route handler.

Frontend tests:

- Light and dark theme rendering.
- Role-aware navigation (CFO sees no mutation buttons; Pending sees only
  the pending screen).
- Analyst entity-scoped queue.
- Collections table and side-panel interactions.
- Export buttons do not appear where role disallows them.
- Ageing-bucket chip palette renders consistently in both themes.

Verification commands (from `AGENTS.md`):

```bash
npm run typecheck
npm run lint
npm run build
```

Add `npm test` before relying on CI for behavioural coverage.

## Implementation Phases

(Detailed in the implementation plan.)

1. Theme & shell refinement.
2. Operational object schema.
3. Collection Task lifecycle.
4. Promise to Pay and Dispute Case workflows.
5. CFO Review.
6. Admin governance and digest controls.
7. Tests and production hardening.

## Out Of Scope (Reaffirmed)

- Cash application — no payment-receipts feed yet.
- General ledger posting.
- Write-off workflow automation (only an exception tag exists).
- CFO comments / approvals (CFO mutates nothing).
- AI recommendations beyond deterministic risk/task rules.
- Importing Twenty UI as a dependency.
- True dunning levels with auto-escalation (Collection Tasks + activities
  cover ~80% of the operational need).
- Customer credit limits and credit utilisation KPIs.

## Refinement Changelog (vs. 2026-05-01 brainstorm draft)

What changed and why, since the prior draft of this spec:

- **Added Naming section (§3, §4 anchors).** Routes, headings, and
  column conventions are pinned. Was previously implicit.
- **Added concrete light + dark token tables.** Specific hex values
  derived as a re-implementation of Twenty's open-source token spirit
  under our own neutral semantic names. Was previously prose-only.
- **Added Tailwind 4 + next-themes wiring spec.** Previously deferred to
  implementation.
- **Added metric Supported / Partial / Future table.** Previously a
  prose hint; now an explicit hide/caveat/show decision per metric.
- **Pinned DSO method.** "DSO (countback, issuance-based) with caveat
  banner". Previously ambiguous.
- **CEI explicitly hidden.** Previously listed as conditional on data.
- **Added Dispute Case ↔ Exception Tag clarification.** Two distinct
  concepts; opening a Dispute may trigger a tag but they are stored
  independently.
- **Added route-level RBAC contract (§11) with two new helpers
  (`assertReadOnlyForCfo`, `assertNotPending`).** Previously prose only.
- **Pinned Digest cron invariants (4 points).** Previously a single
  bullet.
- **Object relationships diagrammed.** Previously prose only.
- **Promise to Pay state transitions specified.** Previously open.
- **AR Roll-Forward labelled "snapshot-to-snapshot movement"** to avoid
  implying we have a cash leg.
- **Ageing-bucket chip palette pinned per theme.**

The companion research notes
(`docs/superpowers/research/2026-05-01-receivables-os-research.md`) carry
the source citations supporting each decision above.

The companion artifacts from the brainstorm session live at
`.superpowers/brainstorm/session-20260501-180459/content/` and remain
useful as the visual reference for the shell.

End of design.
