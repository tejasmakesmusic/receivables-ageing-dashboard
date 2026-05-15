# Twenty CRM Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Receivable OS into a Twenty-inspired, operator-first finance CRM UI with dense tables, keyboard-first workflows, side peek records, and polished flagship screens.

**Architecture:** Land the work in small phase commits. Phase 1 locks design tokens and primitive compatibility. Later phases replace shell, table behavior, peek panels, command palette, and flagship screens without changing AR business rules.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, custom UI primitives, Storybook, Prisma-backed server pages.

---

### Task 1: Phase 1 design tokens foundation

**Files:**
- Create: `tailwind.config.ts`
- Modify: `src/app/globals.css`
- Modify: `src/components/ui/badge.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/status-tag-map.ts`

- [ ] **Step 1:** Add Tailwind config with content globs and dark-mode selector.
- [ ] **Step 2:** Replace global tokens with Twenty-style light/dark tokens, type scale, spacing, radii, shadows, density, focus, and motion variables.
- [ ] **Step 3:** Update button, badge, card, and status-tag tone classes to consume the token system.
- [ ] **Step 4:** Run `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run build`.
- [ ] **Step 5:** Commit and push Phase 1.

### Task 2: Phase 2 shell refactor

**Files:**
- Modify: `src/components/shell/app-shell.tsx`
- Modify: `src/components/shell/Sidebar.tsx`
- Modify: `src/components/shell/topbar.tsx`
- Modify: `src/components/shell/global-command-menu.tsx`

- [ ] **Step 1:** Collapse sidebar width behavior to 240px expanded and 56px collapsed using localStorage.
- [ ] **Step 2:** Rework topbar to 48px with breadcrumb, command trigger, notifications affordance, and avatar.
- [ ] **Step 3:** Preserve Cmd/Ctrl+K behavior.
- [ ] **Step 4:** Run typecheck, lint, build.
- [ ] **Step 5:** Commit and push Phase 2.

### Task 3: Phase 3 DataTable upgrade

**Files:**
- Modify: `src/components/ui/data-table.tsx`
- Modify: `src/components/ui/data-table-row.tsx`
- Modify: `src/components/ui/data-table.stories.tsx`
- Modify: high-use table call sites as needed.

- [ ] **Step 1:** Add density modes with 32px, 36px, and 44px rows.
- [ ] **Step 2:** Add selection column and bulk action bar.
- [ ] **Step 3:** Add filter-chip slot, table actions slot, and loading shimmer rows.
- [ ] **Step 4:** Preserve frozen first column and sticky header.
- [ ] **Step 5:** Run typecheck, lint, build.
- [ ] **Step 6:** Commit and push Phase 3.

### Task 4: Phase 4 side peek records

**Files:**
- Create: `src/components/ui/record-peek.tsx`
- Modify: `src/app/invoices/page.tsx`
- Modify: `src/app/parties/page.tsx`

- [ ] **Step 1:** Build reusable 480px side peek panel with expand and close affordances.
- [ ] **Step 2:** Wire invoice rows to open peeks via query param, preserving full-page links.
- [ ] **Step 3:** Wire party/customer rows to open peeks via query param.
- [ ] **Step 4:** Run typecheck, lint, build.
- [ ] **Step 5:** Commit and push Phase 4.

### Task 5: Phase 5 command palette hardening

**Files:**
- Modify: `src/components/shell/global-command-menu.tsx`
- Modify: `src/components/shell/command-menu-data.ts`
- Modify: `package.json`

- [ ] **Step 1:** Add `cmdk` if dependency installation is approved.
- [ ] **Step 2:** Replace custom menu internals with cmdk while preserving route/action coverage.
- [ ] **Step 3:** Add recent items section.
- [ ] **Step 4:** Run typecheck, lint, build.
- [ ] **Step 5:** Commit and push Phase 5.

### Task 6: Phase 6 flagship screens

**Files:**
- Modify: `src/app/invoices/page.tsx`
- Modify: `src/app/party/[canonicalId]/page.tsx`
- Modify: `src/app/reconciliation/page.tsx`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1:** Invoices list gets CRM tabs, filter chips, dense table, and side peek.
- [ ] **Step 2:** Customer detail gets CRM record header, tabs, right sidebar, and progress treatment.
- [ ] **Step 3:** Reconciliation gets two-pane triage styling using existing data.
- [ ] **Step 4:** Collections dashboard gets clickable metric tiles and polished ageing/top overdue layout.
- [ ] **Step 5:** Run typecheck, lint, build.
- [ ] **Step 6:** Commit and push Phase 6.

### Task 7: Phase 7 polish pass

**Files:**
- Modify relevant primitive stories and affected route files.

- [ ] **Step 1:** Ensure empty states include illustration treatment and CTA.
- [ ] **Step 2:** Ensure icon-only buttons have accessible labels and tooltip plan.
- [ ] **Step 3:** Ensure transitions use tokenized timing/easing.
- [ ] **Step 4:** Run typecheck, lint, build, and Storybook build if practical.
- [ ] **Step 5:** Commit and push Phase 7.
