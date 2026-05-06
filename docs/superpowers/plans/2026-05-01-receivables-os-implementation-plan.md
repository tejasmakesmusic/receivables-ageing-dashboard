# Receivables OS — Implementation Plan

- Date: 2026-05-01
- Status: Draft plan, pending Tejaswa's approval before any
  implementation begins.
- Driven by: `docs/superpowers/specs/2026-05-01-receivables-os-design.md`
- Research backing: `docs/superpowers/research/2026-05-01-receivables-os-research.md`

This is a research-and-planning artefact only. **No application code
will be written until Tejaswa explicitly approves this plan.** The plan
respects all guardrails in `02_HANDOFF_SPEC.md` §15 and `AGENTS.md`.

## Approvals — Locked 2026-05-01

Confirmed by Tejaswa on 2026-05-01:

- **Migration cutover.** Full Alembic → Prisma cutover via ADR-0008.
  Phase 2 freezes Alembic.
- **DSO surface.** "DSO (issuance-based)" + caveat banner everywhere it
  is shown.
- **CFO comments.** Out of scope. CFO Review stays strictly read-only.
- **Audit log granularity for suggest_batch.** One summary row per
  publish with `{snapshot_id, total_count, by_reason_code}` summary
  JSON. Per-task audit row is **not** written at generation;
  reconstruction uses `collection_tasks.created_at` +
  `source_snapshot_id`.

## Plan Overview

Implementation is sequenced in seven phases. Each phase ships an
independently reviewable set of changes that pass `npm run typecheck`,
`npm run lint`, and `npm run build`, with no regression to existing
parser/staging/publish flows.

| Phase | Theme                                                    | Risk  |
|-------|----------------------------------------------------------|-------|
| 1     | Theme & shell refinement (Tailwind 4 tokens, dark mode, command, side panel scaffolding) | Low   |
| 2     | Operational object schema (Prisma: collection_tasks, promises_to_pay, dispute_cases, digest_events) | Med   |
| 3     | Collection Task lifecycle + Workbench (suggested-task generation at publish, table + side panel) | Med   |
| 4     | Promise to Pay + Dispute Case workflows (objects + cross-references) | Med   |
| 5     | CFO Review (read-only metrics surfaces, ageing migration, DSO countback) | Med   |
| 6     | Admin governance + digest controls (FX history page, email rule manager, digest preview/approve, cron handler with locks) | High  |
| 7     | Tests and production hardening (RBAC matrix tests, theme tests, digest cron tests, OAuth, blob storage) | Med   |

Total estimate: 6–8 weeks of single-engineer effort, assuming review
cadence allows phase-by-phase merges.

## Cross-Cutting Constraints

These apply to every phase. They are non-negotiable.

1. **Lazy Prisma client.** Continue using `getPrisma()` in
   `src/lib/prisma.ts`. Never import a Prisma instance at module
   top-level outside that file.
2. **Route-level RBAC.** Every route handler under `src/app/api/` calls
   `getCurrentUser()` + `requireRole()` + entity-scope check (when
   applicable) before any database access.
3. **Audit log on every mutation.** `createAuditLog(actorUserId, action,
   entityType, entityId, before, after)` runs in the same transaction as
   the mutation where possible. If a transaction wrap is impractical, the
   audit row is written *before* returning to the caller and the failure
   path rolls back.
4. **Snapshot `as_of_date` for ageing.** No `Date.now()`, no `new Date()`
   for ageing arithmetic. Re-confirm in code review.
5. **FX rows immutable.** Only INSERT and SELECT in route handlers; no
   UPDATE or DELETE on `fx_rates`. Add a runtime guard.
6. **CFO + Pending mutation-block.** Two new helpers (§Helpers below)
   are called early in every mutating handler.
7. **Parser errors stay staged as `PARSE_ERROR`.** No silent drops.
8. **`npm` only.** No yarn, no pnpm, no bun for this repo.
9. **Vercel-friendly modules.** Any module imported by both server and
   client must not transitively import `@/generated/prisma`. Use
   `server-only` in modules that read secrets or the database.
10. **No `02_HANDOFF_SPEC.md` edits.** Refinements live in this spec and
    plan only.
11. **No secrets in the repo.** `.env*` is git-ignored; verify before
    commits.

## Helpers To Add

These helpers go under `src/server/core/` to centralise the new
guarantees.

- `assertReadOnlyForCfo(user)` — throws `ForbiddenError` if `user.role
  === 'CFO'`. Called by every non-GET route handler.
- `assertNotPending(user)` — throws `ForbiddenError` if `user.role ===
  'PENDING'`. Called at the top of every handler that returns AR data
  (including GETs).
- `assertFxImmutable()` — runtime guard wrapping the `fx_rates` model
  helper that rejects any UPDATE/DELETE attempt at the service layer.
- `assertSnapshotAsOfBased(asOfDate)` — sanity guard that
  `asOfDate` is a `DATE`-shaped value, not a wall-clock timestamp.

Helpers compose with existing `assertAnalystCanAccessEntity` and
`requireRole`.

---

## Phase 1 — Theme & Shell Refinement

Goal: introduce light/dark/system theme support, the Twenty-inspired
shell layout, and the command palette / side panel scaffolding without
changing any AR data behaviour.

### 1.1 Files to add

- `src/app/globals.css` — replace minimal theme with token-driven
  Tailwind 4 setup (light + dark) and `@custom-variant dark`.
- `src/components/theme-provider.tsx` — `'use client'` wrapper around
  `next-themes` `ThemeProvider`.
- `src/components/mode-toggle.tsx` — `'use client'` light/dark/system
  cycler, accessible via keyboard.
- `src/components/shell/app-shell.tsx` — server component, renders
  sidebar + topbar + main grid.
- `src/components/shell/sidebar.tsx` — nav (server component); reads
  current user role to filter items.
- `src/components/shell/topbar.tsx` — global command/search trigger,
  user menu, theme toggle.
- `src/components/shell/command-palette.tsx` — `'use client'` cmdk-style
  palette (lightweight implementation, no external dep needed if shadcn
  primitives suffice; if a dep is required, add to `package.json` via
  `npm install` only).
- `src/components/shell/record-panel.tsx` — `'use client'` right-side
  panel; URL-driven via `?record=<type>:<id>` search params.
- `src/components/ui/table.tsx` — local shadcn-style table primitive
  (header, body, row, cell) tuned for the dense AR layout.
- `src/components/ui/badge.tsx` — extend existing badge with status
  variants (Not Due / 0–30 / 31–60 / 61–90 / 90+).

### 1.2 Files to modify

- `src/app/layout.tsx` — wrap children in `ThemeProvider` and
  `AppShell`. Add `suppressHydrationWarning` on `<html>`.
- `src/components/app-nav.tsx` — replace with the new sidebar/topbar
  composition. Keep file or delete after replacement (Phase 1 cleanup).
- `package.json` — add `next-themes` via `npm install next-themes`.
  Confirm no other dependency drift.

### 1.3 globals.css token layout

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica,
    Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif;

  --color-bg: #ffffff;
  --color-bg-subtle: #fcfcfc;
  --color-bg-muted: #f1f1f1;
  --color-border: #ebebeb;
  --color-border-strong: #d6d6d6;
  --color-text: #333333;
  --color-text-muted: #666666;
  --color-text-subtle: #999999;
  --color-accent: #465fd6;
  --color-accent-soft: #eef2fd;
  --color-success-soft: #e9f7ee;
  --color-warning-soft: #fff6db;
  --color-danger-soft: #fbecec;

  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-pill: 9999px;

  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
}

:root.dark {
  --color-bg: #171717;
  --color-bg-subtle: #1b1b1b;
  --color-bg-muted: #1d1d1d;
  --color-border: #222222;
  --color-border-strong: #333333;
  --color-text: #ebebeb;
  --color-text-muted: #b3b3b3;
  --color-text-subtle: #888888;
  --color-accent: #5f72d6;
  --color-accent-soft: #1b2446;
  --color-success-soft: #193123;
  --color-warning-soft: #352b16;
  --color-danger-soft: #351d1d;
}

@layer base {
  body {
    background-color: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-sans);
    margin: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
}
```

### 1.4 Verification

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm run build` produces a valid Next.js build.
- Manual smoke test: existing pages (`/dashboard`, `/upload`,
  `/snapshots/[id]/staging`, `/follow-ups`, `/invoice/[id]`,
  `/party/[id]`, `/admin/users`, `/admin/audit-log`) render under both
  light and dark modes with no layout regression.
- Theme toggle persists across reload.
- Pending users still see only `/auth/pending`.

### 1.5 Out of scope for Phase 1

- No AR data behaviour changes.
- No new database tables.
- No new business routes.

---

## Phase 2 — Operational Object Schema

Goal: introduce the four new object tables and their indexes. No UI yet;
this phase is database + server services + audit-logged route handlers
with placeholder list/detail GETs.

### 2.1 Migration discipline

Existing migrations are managed by Alembic (`alembic_version` table is
introspected but not actively driven from this Next/Prisma codebase). We
will:

1. Create a new Prisma migration directory: `prisma/migrations/`.
2. Generate the first Prisma migration with `prisma migrate dev` against
   a *local* Postgres (per ADR-0007), verify the SQL, then run `prisma
   migrate deploy` against `DATABASE_URL_DIRECT` for staging/production.
3. The Alembic chain is **frozen**. No new Alembic migrations after
   Phase 2 begins; future schema change is Prisma-only.
4. Document this transition in a new ADR: `docs/adr/0008-prisma-migrations.md`.

### 2.2 Prisma schema changes (`prisma/schema.prisma`)

Add four new models and three new enums. Names use snake_case to match
the existing DB convention.

```prisma
enum collection_task_status {
  SUGGESTED
  OPEN
  IN_PROGRESS
  SNOOZED
  DONE
  DISMISSED
}

enum collection_task_reason_code {
  NINETY_PLUS
  STALE_FOLLOW_UP
  HIGH_VALUE
  DISPUTE_OPEN
  BROKEN_PROMISE
  MANUAL
}

enum collection_task_source_type {
  SUGGESTED
  MANUAL
}

model collection_tasks {
  id                  String   @id @db.Uuid
  entity_id           String   @db.Uuid
  canonical_id        String   @db.Uuid
  invoice_id          String?  @db.Uuid
  source_snapshot_id  String?  @db.Uuid
  source_type         collection_task_source_type
  reason_code         collection_task_reason_code
  priority_score      Decimal  @db.Decimal(10, 2)
  status              collection_task_status @default(SUGGESTED)
  owner_user_id       String?  @db.Uuid
  due_date            DateTime? @db.Date
  completed_at        DateTime? @db.Timestamptz(6)
  dismissed_reason    String?
  created_by          String   @db.Uuid
  created_at          DateTime @default(now()) @db.Timestamptz(6)
  updated_at          DateTime @default(now()) @db.Timestamptz(6)

  entities          entities          @relation(fields: [entity_id], references: [id])
  parties_canonical parties_canonical @relation(fields: [canonical_id], references: [id])
  invoices          invoices?         @relation(fields: [invoice_id], references: [id])
  snapshots         snapshots?        @relation(fields: [source_snapshot_id], references: [id])

  @@index([entity_id, status])
  @@index([canonical_id, status])
  @@index([owner_user_id, status])
}

enum promise_to_pay_status {
  OPEN
  KEPT
  BROKEN
  CANCELLED
}

model promises_to_pay {
  id                  String   @id @db.Uuid
  canonical_id        String   @db.Uuid
  invoice_id          String?  @db.Uuid
  collection_task_id  String?  @db.Uuid
  amount              Decimal  @db.Decimal(18, 2)
  currency            String   @db.VarChar(3)
  promised_date       DateTime @db.Date
  status              promise_to_pay_status @default(OPEN)
  contact_person      String?
  notes               String?
  created_by          String   @db.Uuid
  created_at          DateTime @default(now()) @db.Timestamptz(6)
  updated_at          DateTime @default(now()) @db.Timestamptz(6)

  parties_canonical parties_canonical @relation(fields: [canonical_id], references: [id])
  invoices          invoices?         @relation(fields: [invoice_id], references: [id])
  collection_tasks  collection_tasks? @relation(fields: [collection_task_id], references: [id])

  @@index([canonical_id, status])
}

enum dispute_case_status {
  OPEN
  IN_REVIEW
  WAITING_ON_CUSTOMER
  RESOLVED
  CLOSED
}

model dispute_cases {
  id                       String   @id @db.Uuid
  entity_id                String   @db.Uuid
  canonical_id             String   @db.Uuid
  invoice_id               String?  @db.Uuid
  reason_code              String   @db.VarChar(64)
  description              String
  status                   dispute_case_status @default(OPEN)
  owner_user_id            String?  @db.Uuid
  expected_resolution_date DateTime? @db.Date
  resolved_at              DateTime? @db.Timestamptz(6)
  resolution_note          String?
  created_by               String   @db.Uuid
  created_at               DateTime @default(now()) @db.Timestamptz(6)
  updated_at               DateTime @default(now()) @db.Timestamptz(6)

  entities          entities          @relation(fields: [entity_id], references: [id])
  parties_canonical parties_canonical @relation(fields: [canonical_id], references: [id])
  invoices          invoices?         @relation(fields: [invoice_id], references: [id])

  @@index([entity_id, status])
  @@index([canonical_id, status])
}

enum digest_event_state {
  DRAFT
  PREVIEWED
  APPROVED
  SENT
  SKIPPED
  FAILED
}

model digest_events {
  id              String   @id @db.Uuid
  digest_date     DateTime @db.Date
  state           digest_event_state @default(DRAFT)
  snapshot_ids    Json     @default("[]")
  payload_json    Json?
  approved_by     String?  @db.Uuid
  sent_at         DateTime? @db.Timestamptz(6)
  error_message   String?
  created_at      DateTime @default(now()) @db.Timestamptz(6)
  updated_at      DateTime @default(now()) @db.Timestamptz(6)

  @@unique([digest_date])
  @@index([state, digest_date])
}
```

(Inverse relations to be added on `entities`, `parties_canonical`,
`invoices`, `snapshots` per Prisma's relation-completeness rules.)

Constraint: every `parties_canonical`-referencing model uses
`onDelete: NoAction` to preserve the existing FK behaviour.

### 2.3 Server services to add

- `src/server/collection-tasks/service.ts` — CRUD + suggest pipeline +
  status transitions; all writes audit-logged.
- `src/server/promises-to-pay/service.ts` — CRUD + state machine.
- `src/server/dispute-cases/service.ts` — CRUD + state machine.
- `src/server/digest/service.ts` — Digest Event lifecycle (Phase 6
  exercises the cron handler; service layer lands here).

Each service:

- Uses `getPrisma()` only.
- Exports `createX`, `updateX`, `transitionXStatus` style functions.
- Wraps mutations in `prisma.$transaction(...)` together with the
  `audit_log.create` call.
- Throws domain-specific errors (`ForbiddenError`, `HttpError`,
  `ValidationError`).

### 2.4 Route handlers to add (placeholder GET-only for Phase 2)

- `src/app/api/collection-tasks/route.ts` — `GET` list (entity-scoped).
- `src/app/api/collection-tasks/[id]/route.ts` — `GET` detail.
- `src/app/api/promises-to-pay/route.ts` — `GET` list.
- `src/app/api/promises-to-pay/[id]/route.ts` — `GET` detail.
- `src/app/api/dispute-cases/route.ts` — `GET` list.
- `src/app/api/dispute-cases/[id]/route.ts` — `GET` detail.
- `src/app/api/digest-events/route.ts` — `GET` list (Admin only).
- `src/app/api/digest-events/[id]/route.ts` — `GET` detail.

POST/PATCH endpoints arrive in Phases 3, 4, 6.

### 2.5 Verification

- `npm run typecheck`, `npm run lint`, `npm run build`.
- `prisma migrate dev` clean against local Postgres; `prisma migrate
  deploy` clean against staging.
- Smoke: existing publish pipeline still passes; no regressions to
  invoice / snapshot / follow-up flows.

---

## Phase 3 — Collection Task Lifecycle & Workbench

Goal: surface Collection Tasks and operate the lifecycle. Generate
suggested tasks at publish time using deterministic rules.

### 3.1 Files to add

- `src/app/collections/page.tsx` — server component table view, default
  view *My open tasks*.
- `src/app/collections/_components/task-table.tsx` — server-rendered
  table.
- `src/app/collections/_components/task-filters.tsx` — `'use client'`
  filter bar.
- `src/app/collections/_components/task-side-panel.tsx` — `'use client'`
  side panel with edit forms.
- `src/server/collection-tasks/suggest.ts` — pure function, deterministic
  rule pipeline, called from `src/server/snapshots/service.ts` at publish.
- `src/server/collection-tasks/priority.ts` — pure function for the
  priority score, given amount, bucket, due date, dispute state, PTP
  state, and stale-contact days.
- `src/app/api/collection-tasks/route.ts` — extend with `POST` (manual
  task creation).
- `src/app/api/collection-tasks/[id]/route.ts` — extend with
  `PATCH` (status transitions, owner reassign, snooze, dismiss, complete).

### 3.2 Suggested-task generation rules

Run inside the publish transaction. Read the freshly published
`invoice_snapshots` rows for the snapshot, plus the related Promise to
Pay and Dispute Case state. For each invoice:

| Rule                                       | Resulting reason_code |
|--------------------------------------------|------------------------|
| `bucket = '90+'` AND `outstanding > 0`     | `NINETY_PLUS`          |
| Last activity older than configured stale  | `STALE_FOLLOW_UP`      |
| `outstanding ≥ HIGH_VALUE_THRESHOLD`       | `HIGH_VALUE`           |
| Open Dispute Case linked to the invoice    | `DISPUTE_OPEN`         |
| Broken PTP linked to the invoice           | `BROKEN_PROMISE`       |

A single invoice may emit multiple tasks (one per matching rule). Tasks
are inserted with `status = SUGGESTED` and no owner. Analysts triage to
`OPEN` to claim.

### 3.3 RBAC

- Analyst: list/read/mutate tasks where `entity_id` matches scope.
- CFO: list/read; **no mutation**. `assertReadOnlyForCfo` blocks any
  POST/PATCH.
- Admin: list/read/mutate any entity.
- Pending: blocked at `assertNotPending`.

### 3.4 Audit log entries

Actions: `collection_task.create`, `collection_task.assign`,
`collection_task.status_change`, `collection_task.snooze`,
`collection_task.dismiss`, `collection_task.complete`,
`collection_task.suggest_batch` (single row per snapshot publish).

### 3.5 Verification

- `npm run typecheck`, `npm run lint`, `npm run build`.
- Republish a known fixture snapshot in staging — verify expected
  suggested tasks generated exactly once.
- Manual: analyst triage flow (claim → in-progress → done) writes audit.
- CFO PATCH attempt → 403.
- Pending GET attempt → 403, no DB query.

---

## Phase 4 — Promise to Pay & Dispute Case Workflows

Goal: full CRUD + lifecycle for both objects, surfaced in Customer
Ledger, Invoice detail, and the Collections Workbench side panel.

### 4.1 Files to add

- `src/app/api/promises-to-pay/route.ts` — `POST`.
- `src/app/api/promises-to-pay/[id]/route.ts` — `PATCH` (transition).
- `src/app/api/dispute-cases/route.ts` — `POST`.
- `src/app/api/dispute-cases/[id]/route.ts` — `PATCH` (transition).
- `src/app/party/[canonical_id]/_components/promises-tab.tsx`.
- `src/app/party/[canonical_id]/_components/disputes-tab.tsx`.
- `src/app/invoice/[invoice_id]/_components/promise-form.tsx`.
- `src/app/invoice/[invoice_id]/_components/dispute-form.tsx`.

### 4.2 PTP automatic transitions

Run inside the publish transaction (after invoice snapshot rows are
written, before commit):

- For every `OPEN` PTP whose `invoice_id` is no longer outstanding in
  the new snapshot AND `material_change_flags_json` does not flag the
  party for review → mark `KEPT`. Audit row: `promise_to_pay.auto_kept`.
- For every `OPEN` PTP whose `promised_date < snapshot.as_of_date` AND
  `invoice_id` is still outstanding → mark `BROKEN`. Audit row:
  `promise_to_pay.auto_broken`. This may emit a Collection Task in
  Phase 3 rules.

Operators may also manually transition.

### 4.3 RBAC

Identical pattern to Collection Tasks. Reviewer attention here:
`assertAnalystCanAccessEntity` must check via the *party*'s
`entity_id`, not via the invoice (in case `invoice_id` is null).

### 4.4 Verification

- `npm run typecheck`, `npm run lint`, `npm run build`.
- Test fixture: create OPEN PTP, publish next snapshot with the invoice
  removed → PTP becomes KEPT.
- Test fixture: create OPEN PTP with `promised_date` in the past,
  publish next snapshot with invoice still outstanding → PTP becomes
  BROKEN, Collection Task `BROKEN_PROMISE` is suggested.

---

## Phase 5 — CFO Review

Goal: read-only CFO workspace with consolidated dashboard, ageing
migration, DSO countback (with caveat), Best Possible DSO, customer
concentration, and exportable CFO Pack.

### 5.1 Files to add

- `src/app/dashboard/consolidated/page.tsx` — server component, reads
  latest published snapshot per entity, computes consolidated INR using
  `fx_rates` pinned by `invoice_date`.
- `src/app/dashboard/consolidated/_components/exposure-card.tsx`.
- `src/app/dashboard/consolidated/_components/ageing-migration-chart.tsx` —
  server component renders a Recharts client component with computed
  data passed in via props.
- `src/app/dashboard/consolidated/_components/concentration-table.tsx`.
- `src/app/dashboard/consolidated/_components/dso-card.tsx` — includes
  the caveat banner.
- `src/server/dashboard/consolidated.ts` — pure compute functions.
- `src/server/metrics/dso.ts` — countback DSO from snapshot history.
- `src/server/metrics/ageing-migration.ts`.
- `src/server/metrics/concentration.ts`.

### 5.2 Metric handling

- DSO countback: walk back from current snapshot, subtracting invoice
  issuance per month from outstanding AR until exhausted. Always show
  with caveat banner: "DSO (issuance-based) — based on invoice issuance
  as a credit-sales proxy. Cash-side accuracy requires a payment-receipts
  feed."
- Best Possible DSO: current AR / monthly issuance over trailing N
  months.
- Ageing migration: per consecutive published snapshot, transition matrix
  of weight by bucket.
- 90+ exposure: simple sum from `invoice_snapshots`.
- Customer concentration: top-N party share of total AR.
- CEI: **never displayed**.

### 5.3 RBAC

- CFO: full read access to consolidated and entity views.
- Admin: full read + Admin governance.
- Analyst: their entity only; consolidated route is gated and they
  receive an entity-scoped view instead.
- Pending: blocked.

### 5.4 Verification

- `npm run typecheck`, `npm run lint`, `npm run build`.
- Snapshot test: ageing migration matches a hand-computed fixture.
- DSO regression test: ensure countback uses snapshot `as_of_date`, not
  wall-clock today.
- Theme test: consolidated dashboard renders correctly in dark mode
  (chart contrast).

---

## Phase 6 — Admin Governance & Digest Controls

Goal: complete the Admin surface (FX rates page, email rules manager,
digest preview/approve), and stand up the digest cron handler with the
four invariants from the spec.

### 6.1 Files to add

- `src/app/admin/fx-rates/page.tsx` + `route.ts` — list/insert; **no
  update or delete**. Runtime guard via `assertFxImmutable`.
- `src/app/admin/email-rules/page.tsx` + `route.ts` — Admin can toggle
  `is_active` on rules. The CFO digest rule defaults to inactive.
- `src/app/admin/digest/page.tsx` — Digest Event list, preview, approve.
- `src/app/api/admin/fx-rates/route.ts` — `GET`, `POST` only.
- `src/app/api/admin/email-rules/[id]/route.ts` — `PATCH`.
- `src/app/api/admin/digest-events/[id]/route.ts` — `PATCH` (approve or
  skip).
- `src/app/api/cron/cfo-digest/route.ts` — Vercel Cron endpoint.

### 6.2 Cron handler invariants

```text
1. assertCronCaller(request)         — verify Vercel Cron header / secret.
2. acquireAdvisoryLock(digest_date)  — Postgres pg_try_advisory_xact_lock.
3. checkRule('CFO_DIGEST').is_active — short-circuit if false.
4. createDigestEvent(state=DRAFT)    — persist before payload compile.
5. compilePayload()                  — read snapshots + metrics.
6. transition(DRAFT → PREVIEWED)     — operator preview is optional;
                                       cron may skip to APPROVED only if
                                       configured.
7. transition(APPROVED → SENT)       — only after SMTP success.
8. errorPath: transition(* → FAILED) with error_message.
```

The cron is registered in `vercel.ts` (or `vercel.json` if not yet
migrated) but **not** schedule-active until Tejaswa flips
`email_rules.is_active = true` for `CFO_DIGEST`. Document this in the
runbook (`docs/runbook.md`).

### 6.3 RBAC

- Admin only for every route in this phase.
- `requireRole('ADMIN')` at the top.
- The cron route uses a separate `assertCronCaller(request)` guard
  (matches the Vercel Cron secret) and skips user-session auth entirely.

### 6.4 Verification

- `npm run typecheck`, `npm run lint`, `npm run build`.
- FX immutability test: any PATCH/DELETE on `/api/admin/fx-rates/[id]`
  → 405 / 403.
- Digest cron with `is_active = false`: returns immediately with
  `state = SKIPPED`, no SMTP call, no payload compile.
- Digest cron with `is_active = true` (in test fixture): persists `DRAFT
  → APPROVED → SENT`, SMTP mock invoked exactly once.
- Concurrency test: two simultaneous cron triggers → only one handler
  reaches SMTP; the other observes the advisory lock and exits cleanly
  with `state = SKIPPED`.

---

## Phase 7 — Tests And Production Hardening

Goal: a behavioural test suite that gates merges, plus the operational
items called out in `PROGRESS.md` "Remaining Product/Production Gaps".

### 7.1 Test suite scaffold

- Add `npm test` script, runner is **Vitest** (Node-friendly, integrates
  with TypeScript and Next).
- Test layout:
  - `src/server/**/*.test.ts` for service-layer unit tests.
  - `src/app/api/**/__tests__/*.test.ts` for route handler tests using
    a Postgres test database.
  - `src/components/**/*.test.tsx` for component tests using
    Testing Library.

### 7.2 Required test cases

RBAC matrix:

- For each mutating route handler: 4 tests (Analyst-in-scope,
  Analyst-out-of-scope, CFO, Pending). Expectations: `200/201`, `403`,
  `403`, `403`.
- For each list/detail GET: same 4 tests; CFO is `200`, Pending is
  `403`.

Audit log:

- For each mutating handler: test that exactly one `audit_log` row is
  written with the expected `action`, `entity_type`, and before/after
  payload shape.
- For the publish pipeline: test that the suggest_batch row exists.

Entity scope:

- Cross-entity attempts return 403 with no DB read on the foreign
  entity.

Snapshot `as_of_date`:

- Regression test: call ageing service with a fixture snapshot whose
  `as_of_date` differs from wall-clock today. Verify bucket assignment
  uses `as_of_date`.

FX immutability:

- Attempt UPDATE/DELETE at the service layer → throws.
- Attempt via route handler → 405/403.

Digest event:

- `is_active = false` → no SMTP call.
- Concurrent cron → advisory-lock skip path.
- SMTP failure → `FAILED` state, no `SENT` transition.

Theme:

- Render the Command Center under both `class="dark"` and absent —
  snapshot test passes for both.

### 7.3 Production hardening (independent of tests)

- Wire Production Google OAuth on Vercel. Document required env vars
  in `.env.example` (the existing file already covers most). Set in
  Vercel project settings — never committed.
- Add object storage for retained uploaded workbooks. Use Vercel Blob
  (private). Update `src/server/snapshots/service.ts` to write the
  uploaded workbook to Blob and store the resulting URL on the
  snapshot row instead of relying on ephemeral function filesystem.
- Confirm `vercel.ts` (or `vercel.json`) declares the digest cron only
  if `CFO_DIGEST` rule activation procedure is completed.
- UAT pass against real workflow data with Tejaswa.

### 7.4 Verification

- `npm test` — all tests pass.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- Vercel preview deployment passes manual UAT checklist (theme, RBAC,
  audit log spot-check, snapshot publish path).
- No `.env*` in `git status`; `git ls-files | grep -iE '\\.env|secret'`
  returns nothing.

---

## File-Level Change Map (Cumulative)

### Files to add

```
docs/adr/0008-prisma-migrations.md
prisma/migrations/ (Prisma-managed)
src/app/globals.css                           (replaced)
src/app/layout.tsx                            (modified)
src/app/dashboard/consolidated/page.tsx
src/app/dashboard/consolidated/_components/*.tsx
src/app/close/page.tsx
src/app/reconciliation/page.tsx
src/app/collections/page.tsx
src/app/collections/_components/*.tsx
src/app/credit-risk/page.tsx
src/app/reports/page.tsx
src/app/admin/fx-rates/page.tsx
src/app/admin/email-rules/page.tsx
src/app/admin/digest/page.tsx
src/app/api/collection-tasks/route.ts
src/app/api/collection-tasks/[id]/route.ts
src/app/api/promises-to-pay/route.ts
src/app/api/promises-to-pay/[id]/route.ts
src/app/api/dispute-cases/route.ts
src/app/api/dispute-cases/[id]/route.ts
src/app/api/digest-events/route.ts
src/app/api/digest-events/[id]/route.ts
src/app/api/admin/fx-rates/route.ts
src/app/api/admin/email-rules/[id]/route.ts
src/app/api/admin/digest-events/[id]/route.ts
src/app/api/cron/cfo-digest/route.ts
src/components/theme-provider.tsx
src/components/mode-toggle.tsx
src/components/shell/app-shell.tsx
src/components/shell/sidebar.tsx
src/components/shell/topbar.tsx
src/components/shell/command-palette.tsx
src/components/shell/record-panel.tsx
src/components/ui/table.tsx
src/server/core/assertReadOnlyForCfo.ts
src/server/core/assertNotPending.ts
src/server/core/assertFxImmutable.ts
src/server/core/cron.ts                       (assertCronCaller)
src/server/collection-tasks/service.ts
src/server/collection-tasks/suggest.ts
src/server/collection-tasks/priority.ts
src/server/promises-to-pay/service.ts
src/server/dispute-cases/service.ts
src/server/digest/service.ts
src/server/dashboard/consolidated.ts
src/server/metrics/dso.ts
src/server/metrics/ageing-migration.ts
src/server/metrics/concentration.ts
src/server/blob/uploads.ts                    (Phase 7)
```

### Files to modify

```
prisma/schema.prisma                          (Phase 2)
src/app/layout.tsx                            (Phase 1)
src/components/app-nav.tsx                    (replace or remove in Phase 1)
src/components/ui/badge.tsx                   (Phase 1: status variants)
src/components/ui/button.tsx                  (Phase 1: token-driven styles)
src/components/ui/card.tsx                    (Phase 1)
src/server/snapshots/service.ts               (Phases 3 + 4: suggest tasks; PTP transitions)
package.json                                  (Phase 1: next-themes; Phase 7: vitest)
README.md                                     (Phase 1: theme + scripts)
PROGRESS.md                                   (each phase)
```

### Files NOT to touch

- `02_HANDOFF_SPEC.md` — locked.
- `prisma/local-seed.sql` — minor edits only if a new table needs seed
  rows; never delete existing seed.
- `.env.example` — extend only; never inline real secrets.
- The existing parser modules (`src/server/parsers/`) — Phase 2–6 don't
  change parsing.

---

## Data Model Changes Summary

- 4 new tables: `collection_tasks`, `promises_to_pay`, `dispute_cases`,
  `digest_events`.
- 3 new enums: `collection_task_status`, `collection_task_reason_code`,
  `collection_task_source_type`, `promise_to_pay_status`,
  `dispute_case_status`, `digest_event_state` (six total).
- Inverse relations on `entities`, `parties_canonical`, `invoices`,
  `snapshots` (Prisma relation completeness).
- No changes to existing tables.
- Migration approach: Prisma-managed; freeze Alembic chain after
  Phase 2.

## API / Server Action Plan Summary

- All AR-data mutations go through Route Handlers, not Server Actions.
  Reasons: explicit RBAC enforcement, audit logging, error envelopes,
  testability.
- Server Actions are acceptable only for purely UI-local toggles (theme
  preference, panel collapse). They must not touch AR data.
- Each new Route Handler is paired with: RBAC guard, entity-scope
  guard, audit log write, transactional database call.

## UI Page Plan Summary

- Phase 1 ships the shell. No new business pages.
- Phase 2 ships placeholder route handlers; **no new UI pages** in this
  phase.
- Phase 3 ships `/collections` and the right-side panel pattern.
- Phase 4 surfaces Promise/Dispute tabs in `/party/[id]` and
  `/invoice/[id]`.
- Phase 5 ships `/dashboard/consolidated` (CFO Review).
- Phase 6 ships `/admin/fx-rates`, `/admin/email-rules`,
  `/admin/digest`.
- Phase 7 adds tests; no new pages.

## Test Plan Summary

| Area                              | Phase introduced | Covered by               |
|-----------------------------------|------------------|--------------------------|
| RBAC matrix per route             | 7 (formal)       | Route handler test suite |
| Entity scope                      | 7                | Same                     |
| Audit log per mutation            | 7                | Same                     |
| Snapshot `as_of_date` for ageing  | 5 + 7            | Metric service tests     |
| FX immutability                   | 6 + 7            | FX service tests         |
| Collection task lifecycle         | 3 + 7            | Service + handler tests  |
| Promise to Pay lifecycle          | 4 + 7            | Service tests            |
| Dispute Case lifecycle            | 4 + 7            | Service tests            |
| Digest cron invariants            | 6 + 7            | Cron handler test        |
| Theme rendering                   | 1 + 7            | Component snapshot tests |
| Pending blocked                   | 1 onwards        | Handler tests            |
| CFO read-only                     | 3 onwards        | Handler tests            |

## Verification Commands

```bash
npm install            # add new deps: next-themes (Phase 1), vitest (Phase 7)
npm run typecheck
npm run lint
npm run build
npm test               # available from Phase 7
```

`npm install` lockfile changes must remain `package-lock.json` only —
no other lockfile (yarn / pnpm / bun) is allowed by `AGENTS.md`.

## Risk Register

- **Migration cutover.** Switching schema authority from Alembic to
  Prisma is a one-way step. The new ADR-0008 must capture this. Mitigate
  with a staging rehearsal before production migrate-deploy.
- **Cron activation.** Activating the CFO digest is a single-flip event
  with broad reach. Phase 6 lands the *plumbing* but does not flip the
  rule. Activation is a runbook step controlled by Tejaswa.
- **Theme regression risk.** A token rename can break utility class
  generation in Tailwind 4. Phase 1 must run a full visual smoke pass
  on every existing page before merge.
- **Pending data leakage risk.** Any handler that forgets
  `assertNotPending` could leak AR data. Phase 7 RBAC tests are gated
  by 100% coverage on `assertNotPending` invocations across handlers.
- **Vercel function ephemerality.** Workbook persistence depends on
  Vercel Blob in Phase 7. Until then, treat staging snapshots as
  short-lived and warn users.
- **Audit log volume.** `audit_log.before/after` JSON can balloon for
  bulk operations (e.g., suggest_batch). Use a single-row-per-batch
  pattern with summary JSON; do not write one audit row per generated
  task.

## Approval Gate

**Stop here.** Implementation does not begin until Tejaswa approves
this plan and the refined design spec. If research uncovered material
scope changes (none did, by design), the plan would have stopped at
research.

End of plan.
