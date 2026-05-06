# Production Hardening From PRD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 6 May 2026 PRD launch blockers into small, verifiable implementation slices without violating the locked handoff rules.

**Architecture:** The locked functional behavior still comes from `02_HANDOFF_SPEC.md`; accepted ADRs supersede the older technical stack decisions. Implementation stays in the current Next.js 16 / React 19 / Prisma 7 / Neon / Vercel app and keeps mutations RBAC-protected and audited.

**Tech Stack:** Next.js route handlers, TypeScript domain services, Prisma 7, Neon Postgres, Vercel Cron, Resend, S3/R2-compatible object storage, Vitest.

---

## Source Inputs

- Source PRD: `C:/Users/tejas/Downloads/Receivables_OS_PRD_Twenty_Duolingo_UX_Guidelines.pdf`
- Locked spec: `02_HANDOFF_SPEC.md` sections 2 and 15
- ADRs: `docs/adr/0001-record-architecture-decisions.md` through `docs/adr/0008-prisma-migrations.md`
- Current implementation state: `README.md`, `PROGRESS.md`

## Scope Rules

- Do not edit `02_HANDOFF_SPEC.md`.
- Do not send CFO/customer emails by default; keep email activation explicitly gated.
- Do not invent credit-period defaults, backfill historical data, mutate FX rows, use source ageing fields, or bypass CFO/PENDING mutation restrictions.
- Treat external setup items as tracked launch work, not code-complete claims.
- Keep every code slice test-first where behavior changes.

## PRD-to-Repo Gap Map

| Priority | PRD item | Repo state | Implementation route |
| --- | --- | --- | --- |
| 1 | Production OAuth/env vars | Local dev stub exists; production credentials are external | Document exact env checklist; no code unless validation gap is found |
| 2 | Resend DNS/internal digest test | Resend wrapper and outbox processor exist; DNS is external | Keep email inactive until rule activation; add runbook/checklist |
| 3 | S3/R2 workbook storage and hash retention | `snapshots.upload_file_sha256` and `upload_file_path` exist, but upload currently stores only file name | First code slice: upload workbook bytes to object storage when configured, fail production uploads if storage is missing, store object URI/key |
| 4 | Parser/ageing/RBAC/state-machine test coverage | Unit tests exist; no broad parser/publish/E2E coverage yet | Add targeted Vitest coverage after storage slice |
| 5 | UI token/engagement freeze | Current UI exists, but not tokenized to the PRD design language | Plan separate UI slice; avoid broad restyle inside production-hardening slice |
| 6 | Focus Queue metrics/streak rules | Collection tasks exist; `/focus` route not implemented | Plan separate product-design slice after launch blockers |
| 7 | UAT workbooks/parallel run | Requires finance data and signoff | Add UAT checklist/runbook; cannot complete locally |

---

### Task 1: Workbook Evidence Retention

**Files:**
- Create: `src/server/storage/workbooks.ts`
- Test: `src/server/__tests__/workbook-storage.test.ts`
- Modify: `src/server/snapshots/service.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Modify: `docs/runbook.md`

- [x] **Step 1: Write failing storage unit tests**

Cover:
- Missing object-storage config is allowed in non-production and returns a local development reference.
- Missing object-storage config throws in production.
- Configured storage builds a deterministic workbook object key containing entity code, snapshot id, hash, and sanitized file name.
- Configured storage sends a signed `PUT` request and returns a durable object URI.

Run: `npm test -- src/server/__tests__/workbook-storage.test.ts`
Expected: FAIL because `src/server/storage/workbooks.ts` does not exist.

- [x] **Step 2: Implement the workbook storage helper**

Add a focused helper that:
- Reads storage settings from `env`.
- Uses global `fetch` with AWS SigV4 signing for S3/R2-compatible `PutObject`.
- Uses path-style endpoint URLs when `S3_ENDPOINT` is set.
- Returns `local-dev://<sanitized-file-name>` only outside production when storage is incomplete.
- Throws a clear configuration error in production when storage is incomplete.

Run: `npm test -- src/server/__tests__/workbook-storage.test.ts`
Expected: PASS.

- [x] **Step 3: Wire upload creation to retained workbook storage**

Change `createSnapshotFromUpload()` so it:
- Computes `snapshotId` and `fileSha256` before storage.
- Uploads the original bytes before creating the snapshot.
- Stores the returned object URI/key in `snapshots.upload_file_path`.
- Includes the object URI/key in the `snapshot.create` audit `after` payload.

Run: `npm test`
Expected: PASS.

- [x] **Step 4: Document production configuration**

Update `.env.example` and `docs/runbook.md` with:
- Required storage variables for production.
- R2 endpoint notes.
- Verification steps for upload retention and hash lookup.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 2: Launch Readiness Documentation

**Files:**
- Modify: `docs/runbook.md`
- Modify: `README.md`
- Modify: `PROGRESS.md`

- [x] **Step 1: Add production launch checklist from the PRD**

Capture OAuth, Resend DNS, object storage, cron secrets, monitoring, backups, restore test, UAT, user guide, and rollback plan.

- [x] **Step 2: Separate code-complete from externally blocked**

Mark which items can be verified locally and which require IT/finance signoff.

Run: `npm run lint`
Expected: PASS.

---

### Task 3: Critical Coverage Expansion

**Files:**
- Test: parser/ageing/RBAC/publish-focused tests under `src/server/__tests__/`
- Modify production files only when a failing test reveals a real gap.

- [x] **Step 1: Add parser boundary tests for PRD launch risks**

Cover missing headers, malformed dates, blank rows, and parse-error staging behavior.

- [x] **Step 2: Add ageing boundary tests**

Cover `as_of_date`, due-date boundaries, `NOT_DUE`, `0_30`, `31_60`, `61_90`, `90_PLUS`, and leap-year dates.

- [x] **Step 3: Add RBAC route/service tests for CFO/PENDING mutation denial**

Cover upload/publish/config/task/PTP/dispute mutation attempts where practical without a live database.

Run: `npm test`
Expected: PASS.

---

### Task 4: UI/Engagement Follow-Up Plan

**Files:**
- Create: `docs/superpowers/plans/2026-05-06-focus-queue-ui-engagement.md`

- [x] **Step 1: Create a separate plan for the PRD's Twenty/Duolingo UX items**

Keep it separate from production hardening. Include command menu, saved views, side panels, Focus Queue, progress path, goal chips, nudge cards, and accessibility rules.

- [x] **Step 2: Mark dependencies on product decisions**

Focus Queue metrics, streak/freeze rules, and notification copy need finance/admin approval before implementation.

Run: `npm run typecheck`
Expected: PASS.

---

## First Slice

Start with Task 1. It removes a concrete production blocker, uses existing schema fields, does not require a migration, and can be tested without real S3/R2 credentials by injecting a fake `fetch`.
