# UI V2 PR1 Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first UI V2 showcase slice for Receivables OS with token-driven primitives, theme support, and V2 Home/Upload surfaces behind `NEXT_PUBLIC_UI_V2=true`.

**Architecture:** Keep current routes and server data contracts unchanged. Add focused design-system primitives in `design-system/`, wire a client theme provider at the root, and branch Home/Upload rendering by the existing UI V2 flag while preserving old UI fallback.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, local primitives, CSS variables, localStorage.

---

### Task 1: Theme Provider and Tokens

**Files:**
- Create: `design-system/theme-provider.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `design-system/tokens.ts`

- [ ] Add `ThemeProvider` as a client component that reads `receivables.theme.v1`, supports `light | dark | system`, applies `.dark`, and exposes `data-theme`.
- [ ] Wrap `<AppShell>` in `ThemeProvider`.
- [ ] Extend token exports to include semantic role slots and elevation names.

### Task 2: Complete Primitive Component Surface

**Files:**
- Modify: `design-system/components.tsx`
- Modify: `src/app/design-system/page.tsx`
- Modify: `src/app/_design/page.tsx`

- [ ] Add missing primitives: `DsTextarea`, `DsCombobox`, `DsDatePicker`, `DsStatusPill`, `DsSkeleton`, `DsFilterBar`, `DsStepper`, `DsContextPanel`, `DsDrawer`, `DsTooltip`, and `DsToastViewport`.
- [ ] Add loading state to `DsButton`.
- [ ] Extend `DsDataTable` with loading/empty/error slots and a pagination shell.
- [ ] Update `/design-system` showcase to display the full primitive set in light and dark panels.

### Task 3: Upload V2 Showcase

**Files:**
- Modify: `src/app/upload/page.tsx`
- Modify: `src/app/upload/_components/upload-snapshot-form.tsx`

- [ ] Add a three-step Upload -> Stage validation -> Publish stepper above the form.
- [ ] Replace text-date input with `DsDatePicker`.
- [ ] Use `DsStatusPill`, `DsCard`, `DsButton`, `DsSelect`, and `DsFileDropzone` throughout the V2 path.
- [ ] Keep the same `POST /api/snapshots` FormData contract.

### Task 4: Home V2 Showcase

**Files:**
- Modify: `src/app/page.tsx`

- [ ] Keep one Next Best Action hero first.
- [ ] Keep four KPI cards only.
- [ ] Keep Action Inbox as primary queue.
- [ ] Add `DsContextPanel` for Daily Goal and Quick Actions.
- [ ] Add a compact Today's signals strip.

### Task 5: Documentation and Verification

**Files:**
- Modify: `DESIGN_NOTES.md`

- [ ] Update component API docs and migration map with all primitives.
- [ ] Run `npm.cmd run typecheck`.
- [ ] Run `npm.cmd run lint`.
- [ ] Run `npm.cmd run build`.
- [ ] Run visual browser check on `/design-system`; authenticated Home/Upload checks depend on local auth availability.
- [ ] Commit and push.

### Self-review

- Spec coverage: PR #1 covers tokens, theme provider, primitive set, Home, Upload, docs, and visual route.
- Known gaps outside PR #1: Invoices, Snapshots, Reconciliation, Work Queues, Workflows, Reports, Admin, global native-control elimination, and Lighthouse are later PRs by the approved sequence.
- Placeholder scan: no placeholder tasks; all file responsibilities are explicit.
