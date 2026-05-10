# Sprint 3 – Interaction Parity & Engagement Depth (Next Interaction Set)

## Sprint goal
Move from surface-level token parity to true object-first interaction feel by adding keyboard ergonomics, row-level workflows, and lightweight engagement rhythm aligned to the warm command-center goal.

## Why this sprint
Sprint 2 completed:
- sidebar baseline (order/favorites/recent),
- row-hover rhythm and token polish,
- command palette access (`Ctrl/Cmd+K`, `/`) and grouped actions.

Sprint 3 focuses on "in-motion" feel: how fast an analyst can navigate, act, and recover context.

## Scope
- `src/app` core workbench surfaces
  - `src/app/focus/page.tsx`
  - `src/app/invoices/page.tsx`
  - `src/app/tasks/page.tsx`
  - `src/app/party/[canonicalId]/page.tsx`
  - `src/app/invoice/[invoiceId]/page.tsx`
  - `src/app/reports/page.tsx`
  - `src/app/workflows/page.tsx`
- Shared interaction primitives in `src/components/ui` / `src/components/workspace-*`
- Accessibility and keyboard behavior tests under `src/components/*/__tests__` and `src/server/__tests__`

## Outcomes (acceptance criteria)
1. Keyboard-first workflow
   - `/` and `Cmd/Ctrl+K` keep existing behavior.
   - `↑ ↓ Enter` works for focusable command surfaces and primary row groups.
   - `Esc` closes overlays/modals and clears focus states.
   - `e` opens edit path on the currently focused item where supported.
   - `c` opens/copies create action path on focused collections/queue items where supported.
2. Row action parity
   - Every primary surface with dense rows shows one consistent set of inline quick actions on hover/focus.
   - Entering action path from row and returning returns focus to the originating surface.
   - Quick actions do not bypass RBAC and remain server-routed.
3. View-mode depth
   - At least one additional view-mode option is available for each of:
     - Invoices: table + compact summary mode
     - Tasks: list + kanban mode (if available now)
     - Reconciliation: table + review-by-queue mode
4. Engagement rhythm
   - Focus queue cards include lightweight progress/state chips (daily target, due now, completed today, unresolved follow-ups).
   - Completion copy remains fact-based (amount, reference, due date, status), no celebratory sales language.
5. Quality gates
   - `npm run typecheck`
   - `npm run lint`
   - `npm run build`
   - `npm test` for newly added interaction tests

## Backlog (ordered)

### 1) Keyboard interaction layer
- [x] Create `src/components/interaction/keyboard-command-presets.ts` (shared key map constants: `OPEN`, `CANCEL`, `TOGGLE_VIEW`, `EDIT_ACTIVE`, `CREATE_ACTIVE`).
- [x] Create reusable utility for roving focus over list/table rows.
- [x] Add tests:
  - `src/components/**/interaction-shortcuts.test.tsx`
  - `src/components/**/row-keyboard-nav.test.tsx`

### 2) Focus queue and queue-like rows
- [x] Add keyboard-driven navigation for `/focus` queue rows.
- [x] Add inline action hints for open-in-context using existing route handlers.
- [x] Preserve current row highlight/selection rhythm and avoid layout shift.
- [x] Add route-backed claim/promise/escalate/resolve/tie-out hints using existing workflow destinations.

### 3) Cross-surface row quick-actions standard
- [x] Standardize action affordance row component for invoices + disputes + tasks + parties.
- [x] Ensure `Enter` opens row detail/side panel consistently across shared `DataTable` surfaces.
- [x] Add disputes to the shared row action affordance.
- [x] Add `e` and `c` shortcuts mapping to existing safe server-routed navigation paths for focused rows.

### 4) View mode completion
- [x] Invoices: add compact view toggle through shareable URL state.
- [x] Tasks: evaluate current board/list state; normalize fallback behavior when user has no saved view.
- [x] Reconciliation: add queue-focused alternate layout mode without changing data contracts.
- [x] Persist view preference in local storage while preserving URL state for shareable views.

### 5) Engagement polish
- [x] Add focused progress chips on Focus Queue header.
- [x] Add microcopy consistency coverage for fact-based engagement language.
- [x] Validate with one-pass local route QA on `/focus`, `/tasks`, `/invoices`, `/parties`, and one real `/party/[canonicalId]`.

## Risks
- Keyboard event conflicts with existing form inputs.
- Additional UI states could reintroduce non-token utility values.
- View-mode persistence may conflict across browser tabs/devices if implemented too early.

## Sprint 3 completion criteria
- All backlog items above are implemented or explicitly deferred with rationale.
- No high-severity lint/type/build failures.
- Core interaction pass complete with quick manual verification log on primary surfaces.
