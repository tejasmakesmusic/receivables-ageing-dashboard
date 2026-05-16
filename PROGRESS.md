# Project Progress Snapshot

**As of 2026-05-06 (Phase 9 production-hardening start).**

## Summary

The repository has been reduced to the approved Next.js 16 / React 19 runtime
stack. Non-Next runtime artifacts have been removed from the working tree. The
app now lives at the repository root.

Phases 3–7 are complete. The full AR workflow (collection tasks, PTP, disputes,
digest / email-rules, RBAC hardening, and unit tests) is implemented and
verified against `npm run typecheck`, `npm run lint`, `npm run build`, and
`npm test`.

Phase 9 is now tracking the 6 May 2026 production-readiness PRD. The local
launch-blocker and Focus Queue slices are implemented: uploaded source workbooks
are retained in S3/R2-compatible object storage when configured, production
uploads fail when storage is incomplete, and the analyst operating surface now
has a Focus Queue, audit-safe feedback, and launch system views.

## Current Runtime

| Area       | State                                                     |
| ---------- | --------------------------------------------------------- |
| App        | Next.js 16 App Router + React 19 + TypeScript             |
| Database   | Neon Postgres through Prisma 7 and `@prisma/adapter-neon`; local Postgres via `@prisma/adapter-pg` |
| Styling    | Tailwind CSS 4 + local shadcn-style primitives            |
| Parsing    | SheetJS                                                   |
| Reports    | ExcelJS                                                   |
| Matching   | Fuse.js                                                   |
| Charts     | Recharts                                                  |
| Deployment | Vercel, region `sin1`                                     |

## Implemented Surface

- Dashboard, consolidated dashboard, party detail, invoice detail
- Follow-ups, exceptions, config, admin, audit log
- Snapshot upload, parsing, staging, warnings, reconciliation, publish
- TALLY/XERO invoice publish and CREDIT_PERIOD config publish
- **Read-only Xero API ingestion** (ADR-0012) — UAE snapshots can be staged directly from Xero source invoices through OAuth, AES-256-GCM encrypted refresh tokens, `xero_sync_runs` per-pull audit, and the existing staging/publish pipeline. Xero due dates are never used for ageing.
- Ageing report XLSX export
- Local stub admin auth for development
- **Collection tasks** — list (with entity/reason_code/status filters), PATCH (status machine + snooze_until + assign), audit log on every mutation
- **Priority scoring** — `computePriorityScore()` with correct bucket strings (`90_PLUS`, `61_90`, `31_60`, `0_30`, `NOT_DUE`) and capped 0–100 score
- **Promises-to-pay** — CREATE + PATCH with OPEN→KEPT/BROKEN/CANCELLED state machine; audit on every change
- **Dispute cases** — CREATE + PATCH with full five-state machine; `resolved_at` set only on RESOLVED transition; `resolution_note` required for RESOLVED
- **Digest events** — idempotent trigger, `buildDigestPayload`, approve (email_outbox enqueue), skip (QUEUED outbox cancellation); IST-correct PTP window
- **Email rules** — CRUD with ADMIN guard and audit on patch
- **Admin digest UI** — `/admin/digest` server page (trigger/approve/skip form buttons)
- **Admin email-rules UI** — `/admin/email-rules` server page (read-only table)
- **Vercel Cron** — `30 3 * * 1-5` (IST 9AM Mon–Fri) wired in `vercel.json`; `CRON_SECRET` auth on trigger route
- **RBAC hardening** — `assertReadOnlyForCfo`, `assertNotPending`, `assertAnalystCanAccessEntity` used throughout all routes
- **Unit tests (Phase 7)** — 58 tests across 4 files (guards, state-machines, priority, rbac); Vitest 4 with `server-only` stub
- **`/promises-to-pay` page (Phase 8)** — server-rendered list with status filter, party name join, amount/currency/promised-date/status table
- **`/dispute-cases` page (Phase 8)** — server-rendered list with status filter, entity code + reason code columns
- **Sidebar navigation (Phase 8)** — Promises to Pay + Dispute Cases links added
- **Task side panel (Phase 8)** — "Log Promise to Pay" inline form (amount, date, contact, notes) + "Raise Dispute" inline form (reason_code, description, expected_resolution_date); POSTs to API, `router.refresh()` on success
- **Resend email delivery (Phase 8)** — `src/lib/email.ts` wrapper (soft-fail when `RESEND_API_KEY` absent); `POST /api/admin/email-outbox/process` picks up QUEUED rows and sends via Resend; cron runs every 5 min; `RESEND_API_KEY` / `SMTP_FROM_ADDRESS` added to env schema
- **Admin reconciliation page (Phase 8)** — `/admin/reconciliation` lists PUBLISHED snapshots with MATCHED/MISMATCHED/UNRECONCILED badge + delta column; links to snapshot detail for data entry; mismatch banner alert

- **Workbook evidence retention (Phase 9)** - `src/server/storage/workbooks.ts` stores original uploads in S3/R2-compatible object storage with deterministic keys; `snapshots.upload_file_path` records the retained object URI; production uploads fail if object storage is missing; audit metadata records storage key/state
- **Production launch readiness docs (Phase 9)** - `README.md` and `docs/runbook.md` separate code-verifiable gates from IT/finance/admin signoff gates
- **Focus Queue UI status foundation (Phase 9)** - semantic status tokens and `StatusTag` centralize ageing, snapshot, task, PTP, dispute, reconciliation, and override labels for the upcoming Focus Queue
- **Focus Queue read model and page (Phase 9)** - `/focus` ranks existing collection tasks, due follow-ups, broken PTPs, open/escalated disputes, staging blockers, and reconciliation mismatches with Analyst entity scope and CFO read-only cross-entity visibility
- **Focus action feedback (Phase 9)** - collection PTP/dispute actions now show factual status, date, amount/reference, and priority facts through reusable `ActionFeedback` copy instead of celebratory cash-collection language
- **Saved system views (Phase 9)** - launch views for 90+/high value, broken PTP, unmapped parties, reconciliation mismatches, and due-today work are defined in `src/server/views/system-views.ts` and surfaced as compact tabs on invoices/collections
- **Warm command-center UI slice (Phase 9)** - light-only workspace shell, Today's Focus home, Accounts workspace, Invoice Ageing Workbench, Collections board, Reconciliation Center, Workflows, Reports, and Admin surfaces upgraded with shared dense-table, KPI, empty-state, and right-rail patterns.
- **Global command palette (Phase 9)** - topbar search opens a keyboard-accessible route/action palette with safe navigation commands for workspaces, system views, workbook upload, report export, and operational records.
- **No-stub workspace hardening (Phase 9)** - shell identity now uses workspace context instead of fake users/customers, main workspace actions route to implemented surfaces, disabled placeholder controls were removed from Accounts/Invoices/Collections/Workflows/Admin/party detail, and `src/server/__tests__/no-placeholder-copy.test.ts` guards against reintroducing fake personas or placeholder feature copy.
- **Command menu spike plan (Phase 9)** - `docs/superpowers/plans/2026-05-06-command-menu-global-search.md` gates global search and command actions on an approved role-scoped search contract
- **CI migration gate (Phase 9)** - `.github/workflows/ci.yml` runs `npm run prisma:migrate:status` with `NEON_DATABASE_URL_DIRECT`, covered by `src/server/__tests__/ci-workflow.test.ts`

## Verification Commands

```bash
npm run typecheck   # zero errors
npm run lint        # zero errors/warnings
npm test            # 117/117 tests pass
npm run build       # 83 routes compiled; use a clean .next or stop the local dev server first
```

## Remaining Product/Production Gaps

- Production Google OAuth wiring on Vercel (callback URL + `GOOGLE_CLIENT_ID`/`SECRET` in Vercel dashboard)
- `CRON_SECRET`, `CRON_ACTOR_USER_ID`, `RESEND_API_KEY`, `SMTP_FROM_ADDRESS` set in Vercel environment variables
- S3/R2 object-storage bucket and production credentials configured and smoke-tested on Vercel
- Resend `emb.global` SPF + DKIM DNS records verified (required before any email sends)
- Sentry or equivalent production error monitoring configured
- Vercel Analytics or equivalent performance/usage monitoring enabled
- Neon backup/restore test completed against a non-production database
- Analyst/admin/CFO user guide completed
- Rollback procedure reviewed with launch owner
- UAT against real workflow data
