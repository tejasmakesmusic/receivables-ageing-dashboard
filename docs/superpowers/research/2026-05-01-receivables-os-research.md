# Receivables OS — Research Notes

- Date: 2026-05-01
- Status: Research input for the refined design spec and implementation plan.
- Scope: Background research only. No code, schema, or `02_HANDOFF_SPEC.md` changes.

## How To Read This Document

Each section captures the verified terminology, supported-vs-future judgement, or
implementation constraint that will be folded into:

- `docs/superpowers/specs/2026-05-01-receivables-os-design.md`
- `docs/superpowers/plans/2026-05-01-receivables-os-implementation-plan.md`

Citations are listed inline. The seed URL list provided by the project
(`tejaswa.sharma@emb.global`) is treated as the authoritative source list.
Where a vendor page was unreachable from this session (HTTP 403, generic doc
shell, or a supported-versions page with no body), the section labels the
source as "seed reference" and falls back to vendor-neutral references
(`accountingtools.com`, `apqc.org`, `ifrs.org`, `coso.org`, `nextjs.org`,
`tailwindcss.com`, `ui.shadcn.com`, `vercel.com`, GitHub raw files).

---

## 1. AR / O2C Operating Model

### 1.1 Order-to-Cash (O2C) / Invoice-to-Cash

- **Definition.** O2C is the end-to-end business process from receiving a
  customer order through invoicing and final cash collection. It is broader
  than Invoice-to-Cash (I2C). I2C is the receivables sub-segment that begins
  at invoicing and ends at cash application and ledger close.
- **Stages typically named in vendor docs.** Order capture, credit check,
  order fulfillment, invoicing, AR management, collections, dispute
  management, cash application, deductions, reporting.
- **Receivables OS scope is I2C-only.** This product begins where invoices
  already exist in Tally/Xero. It does not touch order capture, fulfillment,
  or cash application (no payment feed yet).
- **Source seeds.** IBM "Order-to-Cash" topic page (seed reference),
  SAP "Accounts Receivable Automation" product page (seed reference),
  Oracle "Receivables Credit to Cash" doc set (seed reference; confirmed
  reachable but body is paywalled/JS-rendered for unauthenticated fetch).

### 1.2 Accounts Receivable Subledger

- **Definition.** A detailed ledger of customer-by-customer, invoice-by-invoice
  open balances that summarises into the AR control account on the General
  Ledger. Invoice → AR subledger → GL is the canonical chain.
- **Why it matters here.** Tally and Xero are the AR subledgers of record.
  This product is a *read-side* reconciliation, evidence, and operations layer
  over them. It is not the subledger itself. The locked spec D19 enforces
  this with a mandatory tie-out screen.

### 1.3 Aged Trial Balance / Aged Receivables Report

- **Definition.** Snapshot of all open AR balances grouped by ageing bucket
  as of a chosen date. Standard buckets are *Current / Not Due*, *1–30*,
  *31–60*, *61–90*, *Over 90*. Custom buckets are common.
- **Use.** Drives credit risk review, IFRS 9 simplified-approach evidence,
  and collections worklist generation.
- **Project alignment.** D6 already locks the buckets. The user-facing label
  in this product should be **"Aged Trial Balance"** (accounting-grade term)
  rather than "Ageing Report" in CFO-facing surfaces, and **"Aged
  Receivables"** in operator-facing surfaces. Both are accepted.

### 1.4 AR Roll-Forward

- **Formula.** `Beginning AR + Invoices billed − Cash received − Credit
  notes − Write-offs = Ending AR`.
- **Project status.** **Partially supported.** We have beginning and ending
  AR (snapshots) and invoices billed (invoice issuance feed). We do not have
  cash received or credit notes as discrete events. We have a `written-off`
  exception tag but no event log.
- **Recommendation.** Produce a *partial roll-forward* report labelled
  "Snapshot-to-Snapshot AR Movement" until a payment-receipts feed exists.

### 1.5 Dunning

- **Definition.** Structured, escalating customer outreach for overdue
  invoices, with severity levels (e.g., reminder → first dunning → second
  dunning → final notice → legal). Standard in SAP FSCM Collections, Oracle
  Advanced Collections, HighRadius, BlackLine.
- **Project status.** **Future.** This product will frame collections as
  *Collections Activity* (untyped) plus *Collection Tasks* (typed work
  items). True dunning levels with auto-escalation are deferred until the
  email rule infrastructure and customer comms templates are explicitly
  approved.

### 1.6 Promise to Pay (PTP)

- **Definition.** A recorded customer commitment to pay a stated amount by
  a stated date. Lifecycle: *Open → Kept | Broken | Cancelled*. A *Broken*
  PTP commonly auto-generates a follow-up task or escalates dunning.
- **Project status.** **Supported as a new first-class object** (already in
  the design spec). We will source the kept/broken determination from the
  next published snapshot or from explicit operator entry.

### 1.7 Dispute Management / Disputed Receivables

- **Definition.** A customer-asserted reason that a specific invoice is not
  payable as billed (price, quantity, quality, billing error, missing PO).
  Distinct from an internal control exception.
- **Naming clarity.** This product already separates three concerns:
  - **Parser errors** — staged data quality problems with the upload.
  - **Control exceptions** — internal accounting tags (`legal/litigation`,
    `disputed by client`, `credit note pending`, `written-off`) that affect
    reconciliation.
  - **Dispute Cases** — customer-facing dispute lifecycle records.
- **Recommendation.** Keep all three. Tighten naming so they are not
  confused (see §6 naming).

### 1.8 Collections Worklist / Workbench

- **Definition.** A filtered, prioritized queue of invoices or customers
  requiring collection action, with owner assignment, status, due date,
  promise-to-pay, dispute status, and last-activity timestamp.
- **Project alignment.** The `Collections Workbench` page in the design
  spec is the canonical name. "Worklist" is the table inside it.

### 1.9 Credit Risk and Recoverability Review

- **Definition.** Periodic review of AR by ageing, exception tags, dispute
  state, and customer concentration to identify recovery risk.
- **Project alignment.** `Credit & Risk` page in the design spec covers
  this. Recoverability *evidence* feeds the IFRS 9 ECL pack. The product
  does not compute the provision (see §2.10).

### 1.10 CFO Working Capital Review

- **Definition.** Cross-entity, read-only visibility for the CFO into net
  AR exposure, ageing migration, DSO, customer concentration, and unresolved
  control items.
- **Project alignment.** `CFO Review` page in the design spec is read-only.
  CFO comments and CFO-side approvals stay out of scope (mutations are
  forbidden by D5/D17).

### 1.11 Standard Role Names

- Industry roles: *Collector*, *AR Analyst*, *AR Manager*, *Credit Manager*,
  *Controller*, *CFO*. The locked spec D5 fixes our four roles to
  `ANALYST`, `CFO`, `ADMIN`, `PENDING`. We keep those internally and surface
  human-readable role labels in the UI ("Analyst", "CFO", "Administrator",
  "Pending review").

---

## 2. Finance Metrics — Supported / Partial / Future

This section follows a strictly conservative posture: when a payment-receipts
feed is missing, metrics that depend on cash collected are not displayed as
authoritative numbers.

| # | Metric                          | Status     | UI Handling                                           |
|---|---------------------------------|------------|-------------------------------------------------------|
| 1 | DSO (countback)                 | Partial    | Show with caveat banner (invoice-issuance proxy)     |
| 2 | DSO (simple)                    | Partial    | Hide unless requested; countback preferred            |
| 3 | CEI                             | Future     | Hide                                                   |
| 4 | AR Turnover                     | Partial    | Secondary KPI only, with caveat                       |
| 5 | Average Days Delinquent (ADD)   | Partial    | Show paired with DSO caveat                           |
| 6 | Best Possible DSO               | Supported  | Show                                                   |
| 7 | Overdue AR / 90+ Exposure       | Supported  | Show                                                   |
| 8 | Customer Concentration          | Supported  | Show                                                   |
| 9 | Ageing Migration                | Supported  | Show — flagship metric                                |
| 10| Bad-Debt Watchlist              | Supported  | Show, label "operational, not IFRS 9 impairment"      |
| 11| IFRS 9 ECL Provision            | Hidden     | We never output a provision number                    |
| 12| ECL Evidence Pack               | Partial    | Export ageing migration + dispute register + tie-out  |

### 2.1 DSO (Days Sales Outstanding)

- **Simple formula.** `DSO = (AR / Total Credit Sales) × Number of Days`.
- **Countback formula.** Walk back month-by-month subtracting credit sales
  from the AR balance until exhausted; sum the months consumed (with a
  fractional last month). APQC favours countback because it is robust to
  seasonal sales spikes.
- **Inputs available.** AR per snapshot (have), invoice issuance per period
  (proxy for credit sales — have, gross of credit notes).
- **Inputs missing.** Audited net credit sales by period; cash sales vs
  credit sales split (negligible here since the feed is invoice-only).
- **Decision.** Show countback DSO as **"DSO (issuance-based)"** with a
  caveat banner. Hide simple DSO from primary surfaces.
- **Sources.** [APQC DSO measure](https://www.apqc.org/resources/benchmarking/open-standards-benchmarking/measures/days-sales-outstanding),
  [AccountingTools — DSO](https://www.accountingtools.com/articles/days-sales-outstanding-dso).

### 2.2 CEI (Collection Effectiveness Index)

- **Formula.** `CEI = [(Beginning AR + Monthly Credit Sales) − Ending Total
  AR] / [(Beginning AR + Monthly Credit Sales) − Ending Current AR] × 100`.
- **Why deferred.** The numerator implicitly requires what was *collected*
  in the period. Snapshot-disappearance is not a reliable proxy for
  collection because partial payments and credit-note settlements are
  invisible. Computing CEI on inferred settlement systematically understates
  performance and is auditor-unfriendly.
- **Decision.** **Hide.** Mark in product copy as "available once a payment
  feed is wired".
- **Source.** [AccountingTools — CEI](https://www.accountingtools.com/articles/collection-effectiveness-index).

### 2.3 AR Turnover

- **Formula.** `Net Credit Sales / Average AR`.
- **Decision.** Partial. Compute with invoice issuance gross of credit
  notes. Display only as a secondary KPI with the same caveat as DSO. Do
  not display "Days Sales in Turnover" as a separate KPI; it duplicates
  DSO.
- **Source.** Same as DSO.

### 2.4 Average Days Delinquent (ADD)

- **Formula.** `ADD = Actual DSO − Best Possible DSO`.
- **Decision.** Partial — inherits the DSO caveat. Show only on the
  Collections Workbench analytics card, not on CFO Review primary KPIs.
- **Source.** AccountingTools CEI / CRF tradition.

### 2.5 Best Possible DSO

- **Formula.** `BPDSO = (Current AR / Total Credit Sales) × Days`.
- **Decision.** Supported. Current AR is well-defined per snapshot. Pair
  with DSO so the gap (≈ ADD) is visible.

### 2.6 Overdue AR / 90+ Exposure

- **Formula.** Sum `outstanding_amount` per snapshot where `bucket = '90+'`
  (and equivalents). Must use snapshot `as_of_date`, recomputed bucket,
  not Tally `overdue_days`/`due_on`.
- **Decision.** Supported. Already first-class in the schema.

### 2.7 Customer Concentration

- **Formula.** Top-N party share of total AR. Optionally Herfindahl index.
- **Decision.** Supported. Already first-class.

### 2.8 Ageing Migration

- **Formula.** Per consecutive published snapshot, build a transition
  matrix of weight (`outstanding_amount`) by bucket. Flag back-flow (a
  bucket improving without a settlement event) as suspicious.
- **Decision.** Supported. Make this a flagship CFO metric — it is the
  single best signal we can compute today.

### 2.9 Bad-Debt Watchlist

- **Heuristic.** `(overdue_days ≥ 90 AND outstanding_amount ≥ threshold)
  OR exception_tag IN (legal, disputed, credit-note-pending) OR
  follow_up_count ≥ N with no movement OR broken PTP`.
- **Decision.** Supported as an *operational* watchlist. Label clearly
  that this is **not** an IFRS 9 credit-impaired determination.

### 2.10 IFRS 9 ECL Provision Matrix — Evidence Only

- **What we provide.** Ageing migration tables, segmented loss-rate inputs
  derived from observed write-off tags, dispute register, and AR sub-ledger
  to GL tie-out.
- **What we do NOT provide.** A provision number, a forward-looking macro
  overlay, or a journal entry. The provision determination remains
  finance-team owned.
- **Decision.** Position the export as **"ECL Evidence Pack"**, not as a
  provision calculator. Label clearly.
- **Sources.** [IFRS 9 §5.5.15–5.5.17 + IE74–IE77](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2024/issued/part-a/ifrs-9-financial-instruments.pdf),
  [IFRS 9 PIR — Impairment](https://www.ifrs.org/content/dam/ifrs/project/pir-9-impairment/rfi-iasb-2023-1-ifrs9-impairment.pdf).

### 2.11 COSO Framing

- The reconciliation, audit-log, and RBAC primitives map cleanly to COSO
  2013 *Control Activities* and *Information & Communication* components.
- **Decision.** Mention COSO in the auditor evidence pack copy. Do not
  attempt to claim the system is itself a control framework.
- **Source.** [COSO — Guidance on Internal Control](https://www.coso.org/guidance-on-ic).

### 2.12 Data Feeds Needed To Unlock Future Metrics

- Per-invoice payment receipts and date — unlocks true CEI, true Actual
  DSO, ADD, AR turnover with net credit sales, historical loss-rate
  calibration.
- Net credit sales from GL — moves DSO/AR Turnover from "issuance proxy" to
  audited.
- Discrete write-off events with amount and date — unlocks historical loss
  rates for the provision matrix.
- Customer credit limits — enables credit-utilization KPIs.

---

## 3. Twenty-Inspired Visual Language

This product borrows ideas from Twenty's UI as a *design language reference*.
We do **not** import Twenty's package, copy their assets, or reuse their
source files. We re-implement equivalent ideas with our own neutral token
names under Tailwind CSS 4 + local shadcn-style primitives.

### 3.1 Patterns To Adopt

- **Compact left-side object navigation.** Persistent shell, narrow column
  (~210–260 px), small icon + label, active-state pill in soft accent.
- **Table-first object workspaces.** Each operational object (Invoice,
  Party, Snapshot, Collection Task, Promise To Pay, Dispute Case) lands on
  a dense, filterable, group-able table.
- **Persistent right-side record panel.** Click any row → record opens in
  a right rail that stays attached to the table; URL-driven so panels are
  deep-linkable. Dismiss with `Esc`.
- **Saved views per object.** Each object surface ships a small set of
  built-in views (e.g., for Collection Tasks: *My open tasks*, *90+ tasks*,
  *Broken promises*). Users may save additional views per role/scope.
- **Quiet borders, small radii, dense rows.** 4 px / 8 px radius, 8 px
  cell padding, hairline borders. No marketing hero blocks in the operator
  shell.
- **Light / Dark / System experience setting.** Stored as a per-user
  preference. Class-based dark mode driven by `next-themes`.

### 3.2 Patterns To Avoid Borrowing

- Twenty branding (logos, illustration set, marketing typography tone).
- Twenty's source files or npm package.
- Their colour names where they encode product identity (e.g., raw
  `--t-accent-*` token names). We re-implement under neutral names.

### 3.3 Concrete Token Recommendations (re-implemented under our own names)

The values below are *informed* by inspection of Twenty's open-source
`theme-light.css` and `theme-dark.css` as a reference, then translated to
neutral semantic names and approximated to standard sRGB hex. We do **not**
import Twenty's tokens directly.

References inspected:
[theme-light.css](https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-ui/src/theme-constants/theme-light.css),
[theme-dark.css](https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-ui/src/theme-constants/theme-dark.css),
[Twenty experience settings](https://docs.twenty.com/user-guide/settings/capabilities/experience-settings),
[Twenty UI color scheme](https://twenty.com/twenty-ui/section/input/color-scheme).

#### Spacing scale (shared)

| Token         | Value |
|---------------|-------|
| `--spacing-1` | 4px   |
| `--spacing-2` | 8px   |
| `--spacing-3` | 12px  |
| `--spacing-4` | 16px  |
| `--spacing-5` | 20px  |
| `--spacing-6` | 24px  |
| `--spacing-8` | 32px  |

#### Radius (shared)

| Token         | Value | Use                                |
|---------------|-------|-------------------------------------|
| `--radius-xs` | 2px   | Pills, inline tags                  |
| `--radius-sm` | 4px   | Buttons, inputs, nav items          |
| `--radius-md` | 8px   | Cards, panels, modals               |
| `--radius-lg` | 12px  | Reserved for future                 |
| `--radius-pill` | 9999px | Status chips                     |

#### Light theme

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

#### Dark theme

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

#### Status colour rules

- Ageing buckets in *both* light and dark must remain readable: keep
  *Current* neutral, *0–30* informational blue, *31–60* warning amber,
  *61–90* warning orange, *90+* danger red. Status semantics override
  surface tone — do not let dark surfaces flatten the bucket signal.

### 3.4 Theme-switching mechanism

Twenty exposes Light / Dark / System as an *Experience* preference per
user. We will mirror this with `next-themes` (App Router setup below in §4)
and store the per-user preference server-side in the existing `users`
table or in an additive `user_preferences` row.

---

## 4. Current Stack — Verified Best Practices

Citations inline. All sources fetched fresh during this research pass
unless marked "seed reference".

### 4.1 Next.js 16 App Router — Route Handlers

- Route Handlers are defined as `route.ts` under `app/`. They cannot coexist
  with `page.ts` at the same segment.
- **Caching.** Route Handlers are not cached by default. Only `GET` can opt
  into caching with `export const dynamic = 'force-static'`. Other verbs
  are never cached. With Cache Components enabled, `GET` follows the same
  prerender model as UI pages and can use `'use cache'` inside helpers
  (not in the handler body) plus `cacheLife()`.
- **Typed params.** Use the global `RouteContext<'/users/[id]'>` helper.
- **For Receivables OS.** All mutating handlers (`POST/PATCH/PUT/DELETE`)
  are uncached by default. List handlers (`GET`) that show *snapshot*
  data should be left uncached too — analyst views must reflect freshly
  staged or published data immediately.
- **Source.** [Next.js — Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers).

### 4.2 Next.js 16 — Server vs Client Components

- Layouts, pages, and route handlers are **Server Components by default**.
  `'use client'` marks a *boundary*; everything imported below it is in
  the client bundle.
- **Recommendation:** Server Component renders the dense table page,
  passes a small set of props to a Client Component "Filter Bar" /
  "Side Panel" that handles interactivity. Push `'use client'` as low in
  the tree as possible.
- Use `server-only` import in modules that contain Prisma or secrets to
  prevent accidental client bundling.
- Context providers (e.g., `next-themes`) must be Client Components but
  can be rendered from Server Components.
- **Source.** [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).

### 4.3 React 19 + Server Actions

- React 19 form-action syntax and the `use` API are stable in Next 16.
- For this product, we prefer **Route Handlers** for AR mutations because
  RBAC, audit logging, and explicit error envelopes are easier to enforce
  at a single per-route boundary that has its own test suite. Server
  Actions are acceptable for purely UI-local mutations (e.g., toggling a
  side panel preference) but not for AR-data mutations.

### 4.4 Prisma 7 + Neon

- The repo already uses `@prisma/adapter-neon` (and `@prisma/adapter-pg`
  for local) with a lazy global Prisma client (`src/lib/prisma.ts`). This
  is the recommended pattern for Vercel functions.
- The Neon supported-versions reference page does not include setup code,
  so this finding is verified against the **existing repo implementation**
  and the locked ADR-0002 / ADR-0006 / ADR-0007.
- **Pooled vs direct URL.** Use the pooled URL at runtime (`DATABASE_URL`)
  for Vercel function traffic. Reserve `DATABASE_URL_DIRECT` for migration
  and maintenance only (matches ADR-0002).
- **Migrations.** Use `prisma migrate deploy` against `DATABASE_URL_DIRECT`
  for production schema changes. `prisma db push` remains acceptable for
  local Postgres bring-up only.
- **Source seeds.** [Prisma — Neon](https://www.prisma.io/docs/orm/overview/databases/neon)
  (supported-versions list — body not implementation guidance);
  [Neon — Serverless driver](https://neon.com/docs/serverless/serverless-driver)
  (seed reference). Existing repo file `src/lib/prisma.ts` confirms the
  recommended lazy-init pattern.

### 4.5 Tailwind CSS 4

- **`@theme` block** declares design tokens that automatically generate
  utility classes:

  ```css
  @import "tailwindcss";

  @theme {
    --color-bg: #ffffff;
    --color-text: #333333;
    --radius-sm: 4px;
    --radius-md: 8px;
    --spacing-1: 4px;
  }
  ```

- **Class-based dark mode** uses `@custom-variant`:

  ```css
  @custom-variant dark (&:where(.dark, .dark *));
  ```

  After this, `dark:bg-bg-subtle` etc. work. Theme overrides for the dark
  variant are placed inside `:root.dark { ... }` or
  `.dark { ... }` selectors.

- **Both light + dark token values for the same `@theme` variable** are
  declared by setting the default in `@theme` and overriding under
  `.dark` in `:root` or a layered selector:

  ```css
  @theme {
    --color-bg: #ffffff;
  }

  :root.dark {
    --color-bg: #171717;
  }
  ```

- **Source.** [Tailwind — Theme variables](https://tailwindcss.com/docs/theme),
  [Tailwind — Dark mode](https://tailwindcss.com/docs/dark-mode).

### 4.6 shadcn/ui Dark Mode With next-themes

- Install `next-themes`.
- Create a Client Component `components/theme-provider.tsx` that wraps
  `next-themes`'s `ThemeProvider`.
- In `app/layout.tsx`, set `<html lang="en" suppressHydrationWarning>` and
  wrap children in `<ThemeProvider attribute="class" defaultTheme="system"
  enableSystem disableTransitionOnChange>`.
- `suppressHydrationWarning` is required because the class flips on the
  client between SSR and hydration; otherwise React logs a hydration
  mismatch.
- A `ModeToggle` component cycles `light / dark / system` via
  `useTheme()`.
- **Source.** [shadcn — Dark mode (Next.js)](https://ui.shadcn.com/docs/dark-mode/next).

### 4.7 Vercel Environment Variables

- Variables are scoped to **Production**, **Preview**, **Custom
  environments**, and **Development**.
- `vercel env pull` populates `.env` for local dev. `vercel dev`
  auto-loads dev env vars.
- **For Receivables OS.** Production secrets (Google OAuth client/secret,
  SMTP key, `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SESSION_SECRET`) live
  only in Vercel Production environment. Never commit `.env*` files. Use
  preview-environment-specific overrides for any on-call runbook tasks.
- **Limit.** 64 KB total per deployment for env vars (5 KB per var on the
  legacy edge runtime — not relevant for Fluid Compute).
- **Source.** [Vercel — Environment Variables](https://vercel.com/docs/environment-variables).

### 4.8 Vercel Cron + Idempotency

- Cron declarations belong in `vercel.json` (legacy) or `vercel.ts`
  (current recommendation per the platform knowledge update). The CFO
  digest cron is **not yet activated** by product rule (D13 + AGENTS.md).
  When activated, the cron route handler must:
  1. Acquire a Postgres advisory lock keyed on `digest_date` so multiple
     replicas/retries do not double-send.
  2. Persist a `Digest Event` row before sending.
  3. Re-check `email_rules.is_active = true` *inside* the handler.
- **Source seed.** Vercel Cron documentation (general guidance via the
  Vercel docs root).

### 4.9 Gotchas For This Stack

- **Date timezones.** All ageing arithmetic uses `as_of_date` (a `DATE`,
  not `TIMESTAMPTZ`) and `invoice_date` (also `DATE`). Never `Date.now()`,
  never `new Date()` server-side for ageing.
- **Decimal precision.** Prisma maps `Decimal(18, 2)` to `Prisma.Decimal`.
  Always serialise to string at the API boundary; never `.toNumber()` on
  a money column for downstream calculation.
- **JSON columns.** `audit_log.before/after`, `parse_result_json`,
  `staging_overrides_json` — large JSON values blow up route handler
  responses. Paginate audit log queries; do not return full JSON in list
  responses.
- **Large list streaming.** Aged trial balance exports (XLSX) can run long
  on a single function. Vercel default function timeout is now 300 s,
  which is enough for our current data volume but the export should still
  stream where possible.
- **Build-time module evaluation.** Anything at module top level that
  reads `process.env.DATABASE_URL` will fail during `next build` if the
  env var is unset. The repo already uses lazy init (`getPrisma()`) — keep
  it that way.

---

## 5. Twenty Direct Token Reference (open-source, MIT)

For traceability, this is the raw set of tokens we inspected. We do **not**
copy them verbatim into our codebase. Listing here documents the
provenance of our re-implementation choices in §3.3.

- Twenty publishes both light and dark themes under
  `packages/twenty-ui/src/theme-constants/`.
- Twenty's *light* primary background is `display-p3 1 1 1` (white). Their
  *dark* primary background is `display-p3 0.09 0.09 0.09` (≈ `#171717`).
- Twenty's primary border (light) is `display-p3 0.839 0.839 0.839`
  (≈ `#d6d6d6`); border-medium is `≈ #ebebeb`.
- Twenty's primary text (light) is `display-p3 0.2 0.2 0.2` (≈ `#333333`);
  primary text (dark) is `display-p3 0.922 0.922 0.922` (≈ `#ebebeb`).
- Twenty's font family is `Inter, sans-serif`. Our existing `globals.css`
  already declares `--font-sans: Inter, ...`, so we do not change that.
- Twenty's radius scale: `xs 2px / sm 4px / md 8px / xl 20px / xxl 40px /
  pill 9999px / rounded 100%`.

These values informed §3.3 only as a *reference* for typical operator-CRM
density. The values we will commit are the neutral semantic tokens in
§3.3, not Twenty's `--t-*` names.

---

## 6. Naming Recommendations

The product is read by analysts, CFO, admin, and external auditors.
Terminology should match what they recognize.

### 6.1 Primary navigation labels

| Internal route                | Nav label (recommended)         |
|--------------------------------|---------------------------------|
| `/dashboard`                   | AR Command Center               |
| `/dashboard/consolidated`      | CFO Review                      |
| `/close`                       | AR Close & Certification        |
| `/upload`                      | Snapshot Intake                 |
| `/staging/:id`                 | Staging Controls                |
| `/reconciliation`              | Subledger Tie-Out               |
| `/collections`                 | Collections Workbench           |
| `/credit-risk`                 | Credit & Risk                   |
| `/party/:id`                   | Customer Ledger                 |
| `/invoices`                    | Invoices                        |
| `/follow-ups`                  | Collections Activity            |
| `/exceptions`                  | Control Exceptions              |
| `/reports`                     | Reports & Exports               |
| `/admin/users`                 | User Governance                 |
| `/admin/fx-rates`              | FX Rates                        |
| `/admin/email-rules`           | Email Rules                     |
| `/admin/audit-log`             | Audit Log                       |

### 6.2 Page heading pairs

Some pages need a CFO-facing heading and an operator-facing subheading:

- AR Command Center → "AR Command Center" (h1) / "Aged Receivables —
  &lt;entity&gt;" (h2 on entity-scoped views).
- CFO Review → "CFO Review" (h1) / "Aged Trial Balance, ageing
  migration, and 90+ exposure" (h2).
- Reconciliation → "Subledger Tie-Out" (h1) / "Dashboard AR vs Tally /
  Xero closing AR" (h2).

### 6.3 Table column headers

- Use **"Outstanding"** rather than "Amount" when the column is unpaid
  balance — disambiguates from invoice amount.
- Use **"Days Overdue"** rather than "Overdue Days" — verb-noun ordering
  is the accounting convention.
- Use **"Bucket"** as a short header in tables; the full label "Ageing
  Bucket" goes in tooltips/legends.
- Use **"As Of"** for the snapshot date column; the full label "Snapshot
  As-Of Date" goes in tooltips.
- Use **"Owner"** for the assigned user (collection task, dispute case,
  follow-up).

### 6.4 Tooltips / glossary terms

The Help sheet should expand short terms to their accounting equivalent:

- "Bucket" → "Ageing bucket: time elapsed past our computed due date."
- "Outstanding" → "Open balance on the snapshot's as-of date."
- "Tie-out" → "AR sub-ledger to GL reconciliation."
- "Watchlist" → "Operational risk watchlist — not an IFRS 9 impairment
  determination."
- "Evidence Pack" → "ECL evidence inputs (ageing migration, dispute
  register, tie-out). Not a provision number."

---

## 7. Open Risks To Surface To Tejaswa

1. **No payment-receipts feed.** All cash-collection metrics (CEI,
   true-DSO, ADD vs actual collections) stay hidden until this is wired.
   Stakeholders may push back if they expect "DSO" to mean the cash-side
   metric. Recommendation: rename to "DSO (issuance-based)" with caveat
   banner; do not silently approximate.
2. **CFO comments out of scope.** D5/D17 forbid CFO mutations. Any
   pressure to "let the CFO leave a note" must be re-scoped: an Admin
   could enter a CFO-attributed note, but the digest itself stays
   one-way.
3. **Dunning levels deferred.** SAP-style escalating dunning levels are
   not in scope. Collection Tasks + activities + Promise to Pay cover
   ~80% of the operational need without committing to dunning templates.
4. **ECL evidence pack ≠ provision matrix.** Auditors may ask for the
   provision number. The product must keep that as a labelled
   non-feature.
5. **Snapshot disappearance ≠ collection.** Settlement is currently
   inferred from invoice disappearance across snapshots. This is wrong
   for partial payments. Any metric labelled "collected" must be hidden
   or relabelled "settled-or-disappeared".
6. **Material spec deviation candidates.** None of the research above
   contradicts `02_HANDOFF_SPEC.md`. Naming refinements (e.g., "Subledger
   Tie-Out" vs "Reconciliation Screen") are *labels*, not behavioural
   changes.

---

## 8. Sources Index

Fetched and verified during this research pass:

- [Next.js 16 — Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) — version 16.2.4, last updated 2026-04-10.
- [Next.js 16 — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — version 16.2.4.
- [Tailwind CSS — Theme variables](https://tailwindcss.com/docs/theme).
- [Tailwind CSS — Dark mode](https://tailwindcss.com/docs/dark-mode).
- [shadcn/ui — Next.js Dark Mode](https://ui.shadcn.com/docs/dark-mode/next).
- [Vercel — Environment variables](https://vercel.com/docs/environment-variables) — last updated 2026-02-23.
- Twenty `theme-light.css` — open-source, MIT — inspected raw at GitHub.
- Twenty `theme-dark.css` — open-source, MIT — inspected raw at GitHub.

Seed references (canonical sources cited but not freshly fetched in this
pass):

- [IBM — Order-to-Cash](https://www.ibm.com/think/topics/order-to-cash-o2c) (HTTP 403 to automated fetch; treated as seed reference).
- [SAP — AR Automation](https://www.sap.com/products/financial-management/accounts-receivable-automation.html).
- [Oracle — Receivables Credit-to-Cash](https://docs.oracle.com/en/cloud/saas/financials/index.html).
- [APQC — DSO measure](https://www.apqc.org/resources/benchmarking/open-standards-benchmarking/measures/days-sales-outstanding).
- [AccountingTools — DSO](https://www.accountingtools.com/articles/days-sales-outstanding-dso).
- [AccountingTools — CEI](https://www.accountingtools.com/articles/collection-effectiveness-index).
- [IFRS 9](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2024/issued/part-a/ifrs-9-financial-instruments.pdf).
- [IFRS 9 PIR — Impairment](https://www.ifrs.org/content/dam/ifrs/project/pir-9-impairment/rfi-iasb-2023-1-ifrs9-impairment.pdf).
- [COSO — Guidance on IC](https://www.coso.org/guidance-on-ic).
- [Twenty UI — Color scheme](https://twenty.com/twenty-ui/section/input/color-scheme).
- [Twenty docs — Experience settings](https://docs.twenty.com/user-guide/settings/capabilities/experience-settings).
- [Twenty repo](https://github.com/twentyhq/twenty).
- [Prisma — Neon](https://www.prisma.io/docs/orm/overview/databases/neon).
- [Neon — Serverless driver](https://neon.com/docs/serverless/serverless-driver).

---

End of research notes.
