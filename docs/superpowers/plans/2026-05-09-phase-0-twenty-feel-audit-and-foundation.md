# Phase 0: Twenty/CRM Experience Feasibility & Gap Audit

Goal for this phase:
Create a concrete baseline of what already exists, what must be fixed for a true
Twenty-inspired feel, and a two-sprint execution plan for the first implementation
wave.

## 0) Guardrails (must keep in scope)

- Read and keep aligned with:
  - `02_HANDOFF_SPEC.md` (design frozen, locked decisions)
  - `docs/adr/*` (architecture decisions)
  - `README.md` / `PROGRESS.md` (stack and completion status)
  - `docs/Receivables_OS_PRD_Twenty_Duolingo_UX_Guidelines.md`
- Enforced always-dos from AGENTS:
  - Token-first styling + lazy Prisma + route RBAC + audit log on mutation
  - no inventing credit defaults or mutating FX rows
  - as-of-date ageing + snapshot-driven business logic

## 1) Current parity snapshot (what already exists)

This is implemented and active already:

1. Object-like workspace surfaces:
   - Home focus, Dashboard, Parties, Invoices, Tasks, Reconciliation, Snapshots,
     Workflows, Reports, Admin.
2. Persistent shell:
   - Topbar + sidebar + route framing from `src/components/shell/*`.
3. Command/quick access surface:
  - `Cmd/Ctrl+K` command menu with workspace/action/record jump.
4. Saved views basics:
  - View tabs for Invoices and Tasks, plus system views in
    `src/server/views/system-views.ts`.
5. Dense row-driven workflows:
  - Data table primitives + side panels for contextual inspection.
6. Three interaction rails implemented:
  - Queue (focus/tasks), ageing workbench, reconciliation loop.
7. Visual tokens are partially adopted:
  - Base tokens in `src/app/globals.css` + tokenized page components.

## 2) Gap matrix (Twenty-inspired feel vs current app)

### 2.1 Navigation shell and command affordances
- **Status:** Mostly done.
- **Gaps:**
  - Missing favorites/reorderable navigation patterns in sidebar.
  - No `/` focus shortcut yet in search component.
  - Command results still static set (no live object search endpoint).
  - No direct in-shell search bar + command menu distinction.

### 2.2 Object-first workspaces and views
- **Status:** Mostly done.
- **Gaps:**
  - View modes are not yet full parity across all surfaces (table/kanban/calendar with editable settings in each surface).
  - Some routes still use legacy utility classes and old page structure (not all surfaces consume tokenized primitives).
  - Saved view persistence exists but missing full management UX (rename/archive/favorites metadata flow still incomplete).

### 2.3 Record/page depth and relation workbench
- **Status:** Strong foundation, incomplete depth.
- **Gaps:**
  - Right-side panels are strong for row context, but no editable multi-widget record page equivalent yet.
  - Cross-linking is present; relation layout is still list-to-detail focused.
  - Limited inline actions on row selection path across all surfaces.

### 2.4 Keyboard and action ergonomics
- **Status:** Partial.
- **Gaps:**
  - Row actions are mostly link/submit based.
  - Need explicit keyboard conventions (`/`, `Enter`, `Esc`, `e`, `c`, quick claim actions).
  - Need micro interaction consistency (focus outlines, active states, row affordances).

### 2.5 Design language and component consistency
- **Status:** Mixed.
- **Gaps:**
  - New surfaces are tokenized; several routes still use `slate-*`.
  - Legacy route pages with `bg-slate-*` and `text-slate-*` remain and create perceptual inconsistency.
  - Some typography and spacing scale differences between older and newer pages.

### 2.6 Engagement loop (Duolingo layer)
- **Status:** Partial.
- **Gaps:**
  - Focus queue + nudges exist, but no streak/goal progression UX at surface-level.
  - No completion microcopy and actionability rhythm for daily habits.

## 3) Phase 0 execution outcome checklist

After Phase 0, we should be able to say:

- The app has a documented Twenty feel baseline with concrete measurable gaps.
- Command palette and sidebar patterns are standardized and mapped to role scope.
- All new UI path work is behind token-only tokens in priority surfaces.
- A “first pass parity” route list exists (Home, Invoices, Parties, Tasks, Focus) with
  explicit acceptance criteria.

## 4) Phase 0 sprint tasks (2 weeks)

### Sprint 1 (Days 1–4): UX baseline hardening
1. Inventory and annotate all non-token class drift in `src/app` and core shell components.
2. Create canonical token conformance manifest:
   - allowed tokenized class list
   - disallowed hard-coded colors list
3. Add command menu UX polish:
   - add `/` focus toggle
   - add quick-result grouping + score hints + category labels
   - add "open in new tab" and keyboard hint bar
4. Define navigation behavior matrix:
   - favorites, object order, recent surfaces, role-shown items

### Sprint 2 (Days 5–10): Interaction parity hardening
1. Sidebar feature baseline:
   - user-ordered object sections (stored in user prefs)
   - quick filter/search in sidebar
2. View system baseline:
   - system view metadata consistency + per-surface defaults
   - view rename/remove permissions + empty states standardization
3. Table → right-panel consistency:
   - uniform row hover/selection rhythm
   - inline quick actions + keyboard fallbacks
4. Visual polish:
   - migrate all remaining core surfaces from legacy `slate` classes
   - align spacing, iconography, focus states, disabled states

## 5) Risks / assumptions for this phase

- Not changing domain logic/stack during Phase 0.
- Keep non-intrusive to existing parser/reconciliation/mutation flows.
- Feature scope stays strictly in UI/UX and interaction behavior.

## 6) Next step after Phase 0

Start Phase 1 by implementing:
- sidebar favorites + reorder
- keyboard map (`/`, `Enter`, `Esc`, `e`, `c`)
- one additional view mode per major surface (kanban/calendar)
- row-level quick actions and task/action chips

