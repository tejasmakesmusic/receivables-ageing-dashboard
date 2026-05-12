# Sprint 2 – Sidebar Baseline & Interaction Hardening

## Goal
Complete the first concrete Sprint 2 capability from Phase 0: navigation baseline hardening.

## Scope started
- [x] Quick sidebar filter/search.
- [x] Re-orderable navigation (saved in local preferences).
- [x] Favorites/pinning affordance with icon state.
- [x] Personalized ordering persisted in `localStorage`.
- [x] All interactions remain token-first and shell-consistent.

## Completed file
- [src/components/shell/Sidebar.tsx](C:/Users/tejas/Projects/receivables/src/components/shell/Sidebar.tsx)

## Behavior shipped
- Sidebar reads persisted order + favorites from:
  - `receivables.sidebar.nav-order.v1`
  - `receivables.sidebar.nav-favorites.v1`
- Sidebar also reads/writes recent surface visits from:
  - `receivables.sidebar.nav-recent.v1`
- Re-order controls move entries up/down.
- Favorites section is shown above standard entries; search can narrow both.
- A "Recent" section is seeded from recent navigation events and scoped by role.
- Active item highlighting and existing route matching preserved.

## Open Sprint 2 risks
- Current persistence is localStorage only (not user-account level).
- Re-order controls are visible on hover.
- Role-based visibility now wired in `Sidebar.tsx`.

## Next Sprint 2 items (remaining)
1. [x] Role-scoped nav visibility (Analyst/CFO/Admin differences).
2. [x] Sidebar "Recent" section seeded from recent navigation events.
3. [x] Per-surface view-mode baseline (kanban/calendar toggles where applicable).
4. [x] Row hover/selection rhythm alignment across table surfaces.
5. [x] Finish remaining command/feel polish and token audit on core screens.
