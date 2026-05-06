# Focus Queue UI Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the PRD's Twenty-inspired object workspace and Duolingo-inspired disciplined-work loops without weakening finance controls.

**Architecture:** Keep the existing Next.js App Router pages and server services. Add the Focus Queue as a role-scoped operating view over existing collection tasks, promises to pay, disputes, staging blockers, and reconciliation status; avoid new gamification data tables until finance/admin approves goal, streak, and freeze rules.

**Tech Stack:** Next.js 16 App Router, React 19 server/client components, TypeScript, Prisma 7, Tailwind CSS 4, local shadcn-style primitives, Vitest, optional Storybook only after project setup is approved.

---

## Product Decisions Required Before Implementation

- Default daily analyst goal: recommended start is 10 controllable actions per workday, counted across due follow-ups, task completions, warning resolutions, PTP reviews, dispute updates, and reconciliation submissions.
- Streak policy: recommended launch state is "progress only, no visible streak count" until holiday/leave/freeze ownership is approved.
- Freeze reasons: recommended controlled set is `PUBLIC_HOLIDAY`, `APPROVED_LEAVE`, `FINANCE_CLOSE`, and `SYSTEM_OUTAGE`.
- Notification copy: product/finance must approve calm nudge copy before analyst reminders are enabled.
- Saved views ownership: recommended launch state is system views only; user-created private/shared views can follow after UAT.

---

### Task 1: UI Token And Status Tag Foundation

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/badge.tsx`
- Create: `src/components/ui/status-tag.tsx`
- Test: `src/server/__tests__/ui-status-map.test.ts`

- [x] **Step 1: Add semantic status map tests**

Create tests for all finance states: `NOT_DUE`, `0_30`, `31_60`, `61_90`, `90_PLUS`, `SETTLED`, `PTP_OPEN`, `PTP_BROKEN`, `DISPUTE_OPEN`, `MATCHED`, `MISMATCH`, and `OVERRIDE`.

Run: `npm test -- src/server/__tests__/ui-status-map.test.ts`
Expected: FAIL because the status map does not exist yet.

- [x] **Step 2: Add reusable status tags**

Implement `status-tag.tsx` with text labels and class variants. Do not rely on color alone; every tag renders the label.

- [x] **Step 3: Replace ad hoc badge usage on key list pages**

Use `StatusTag` in dashboard, snapshots, tasks, promises, disputes, and reconciliation pages where matching statuses already appear.

Run: `npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 2: Focus Queue Read Model

**Files:**
- Create: `src/server/focus/service.ts`
- Create: `src/server/__tests__/focus-service.test.ts`
- Create: `src/app/focus/page.tsx`
- Modify: `src/components/shell/Sidebar.tsx`

- [x] **Step 1: Write failing read-model tests**

Cover:
- Analyst sees only own entity work.
- CFO receives read-only cross-entity focus summary.
- PENDING users are denied by page auth before data load.
- Queue includes due follow-ups, 90+ high-priority tasks, broken PTPs, open/escalated disputes, staging blockers, and reconciliation mismatches.
- Ranking explanation is returned with each item.

Run: `npm test -- src/server/__tests__/focus-service.test.ts`
Expected: FAIL because `focus/service.ts` does not exist.

- [x] **Step 2: Implement Focus Queue service**

Return a pure DTO:

```ts
interface FocusQueueItem {
  id: string;
  type: "TASK" | "PTP" | "DISPUTE" | "STAGING_BLOCKER" | "RECONCILIATION";
  entity_code: "IND" | "UAE";
  title: string;
  subtitle: string;
  priority_score: number;
  reason: string;
  href: string;
  due_date: string | null;
  status: string;
}
```

- [x] **Step 3: Build `/focus` page**

Render a dense list with a compact progress header. Do not add streaks yet; show "Today's focus" progress only from current open queue items.

- [x] **Step 4: Add navigation**

Add `Focus Queue` to the sidebar for Analyst/Admin and read-only CFO view.

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

---

### Task 3: Focus Action Feedback

**Files:**
- Modify: `src/app/collections/_components/task-side-panel.tsx`
- Modify: `src/app/collections/_components/task-table.tsx`
- Create: `src/components/ui/action-feedback.tsx`

- [x] **Step 1: Add UI state tests where practical**

Cover deterministic status-to-copy helpers for follow-up logged, task snoozed, PTP created, dispute raised, and reconciliation submitted.

- [x] **Step 2: Add factual action feedback**

After a successful action, show audit-safe facts: record updated, next due/reminder date, status, and whether priority changed. Avoid praise tied to cash collection.

Run: `npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 4: Saved System Views

**Files:**
- Create: `src/server/views/system-views.ts`
- Create: `src/server/__tests__/system-views.test.ts`
- Modify: `src/app/invoices/page.tsx`
- Modify: `src/app/collections/page.tsx`

- [x] **Step 1: Write system-view tests**

Define launch system views:
- `90_PLUS_HIGH_VALUE`
- `BROKEN_PTP`
- `UNMAPPED_PARTIES`
- `RECONCILIATION_MISMATCHES`
- `DUE_TODAY`

- [x] **Step 2: Add system-view filter mapping**

Map each view to existing query filters or a server-side DTO. Do not add persisted custom views in this task.

- [x] **Step 3: Add compact view tabs**

Add tabs/segmented controls to relevant pages using existing UI primitives.

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 5: Command Menu Spike Plan

**Files:**
- Create: `docs/superpowers/plans/2026-05-06-command-menu-global-search.md`

- [x] **Step 1: Plan command menu separately**

Include `/` search focus, Cmd/Ctrl+K, grouped results, role scope, and actions for upload, focus, search invoice/party, PTP, dispute, ageing export, digest approval, and audit log.

- [x] **Step 2: Gate implementation on search contract**

Do not implement command menu until invoice/party/task search contract is approved, because cross-entity leakage risk is high.

Run: `npm run lint`
Expected: PASS.

---

## Guardrails

- Do not reward money collected, customer pressure, invoice closure without evidence, override usage, or dispute suppression.
- CFO remains read-only for operational mutations.
- All Focus Queue items must link back to auditable source records.
- Every mutation still uses existing route handlers and audit logging.
- Keep the launch version desktop-first for analyst workflows; CFO dashboard/detail views still need responsive checks.
