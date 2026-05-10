# Sprint 1 – UX Baseline Hardening (Token Conformance)

## Sprint goal
Deliver a consistent token-first experience in core routes by removing legacy color utility drift and completing the command palette polish from Phase 0.

## Scope definition
- In-scope:
  - `src/app/*` core user flows (dashboard/admin/uploads/invoices/snaps/auth/config/follow-ups).
  - `src/components/shell/*` and shared command/menu pieces.
  - `src/components/app-nav.tsx`.
- Out-of-scope for Sprint 1:
  - New domain logic/permissions/business-rule changes.
  - New data model work.
  - New surfaces outside receipts/objects currently implemented.

## Canonical token policy for Sprint 1
- Colors must resolve to `var(--color-*)` tokens from `src/app/globals.css`.
- Allowed color-related utility sources:
  - bg tokens: `--color-bg`, `--color-bg-subtle`, `--color-bg-muted`, `--color-surface`
  - text tokens: `--color-text`, `--color-text-muted`, `--color-text-subtle`, `--color-text-disabled`
  - border tokens: `--color-border`, `--color-border-medium`, `--color-border-strong`
  - status tokens in `--color-status-*` and accent tokens in `--color-accent*`
- Disallowed legacy families (hard fail for touched files):
  - `slate-*`, `zinc-*`, `gray-*`, `neutral-*` for background/text/border.
- Exception handling:
  - Tailwind spacing, rounding, shadow, typography scale classes are allowed unless they are from unsupported UI tokens.

## Current legacy color-class inventory (from `rg` sweep)

### Auth
- `src/app/auth/pending/page.tsx`
  - `bg-slate-50`, `bg-white`, `border-slate-200`, `text-slate-900`, `text-slate-600`

### Config
- `src/app/config/page.tsx`
  - `bg-slate-50`, `text-slate-900`, `text-slate-500`, `bg-slate-100`, table header/label classes.

### Invoice detail
- `src/app/invoice/[invoiceId]/page.tsx`
  - `bg-slate-50`, `text-slate-900`, `text-slate-700`, `bg-slate-100`, `border-slate-200`, `text-slate-500`, `text-slate-600`

### Snapshots
- `src/app/snapshots/[snapshotId]/page.tsx`
  - `bg-slate-50`, `text-slate-900`, and several `text-slate-500` labels in the metadata section.

### Upload
- `src/app/upload/_components/upload-snapshot-form.tsx`
  - `border-slate-200`, `bg-white`, `bg-slate-900`, `text-white`
- `src/app/upload/page.tsx`
  - already converted in current working copy (re-check as part of PR review).

### Follow-ups
- `src/app/follow-ups/_components/create-follow-up-form.tsx`
  - `border-slate-200`, `text-slate-600`.

### Digest / Admin / Email rules / Dashboard
- These were already tokenized in the current working changes.

## Sprint 1 acceptance criteria
1. Command palette:
   - `Ctrl/Cmd+K` opens/close.
   - `/` opens with search focus outside editable inputs.
   - Results are grouped + show section labels.
   - Keyboard hint bar exists (search shortcuts, open in new tab).
   - `Ctrl/Cmd+Enter` opens selection in new tab.
2. Token conformance:
   - No touched files in Sprint 1 contain `slate/zinc/gray/neutral` background/text/border color utilities.
   - New/updated pages consistently use tokenized `var(--color-*)` utilities.
3. Validation:
   - Manual smoke test for command palette focus behavior.
   - Manual visual audit for converted core screens in a dark/light parity check.

## Next implementation list (ordered)
1. ✅ Convert `src/app/auth/pending/page.tsx`.
2. ✅ Convert `src/app/config/page.tsx`.
3. ✅ Convert `src/app/upload/_components/upload-snapshot-form.tsx`.
4. ✅ Convert `src/app/follow-ups/_components/create-follow-up-form.tsx`.
5. ✅ Convert `src/app/invoice/[invoiceId]/page.tsx`.
6. ✅ Convert `src/app/snapshots/[snapshotId]/page.tsx`.
7. ✅ Convert `src/app/admin/digest/_components/digest-action-buttons.tsx`.

## Sprint 1 completion
- All legacy `slate/zinc/gray/neutral` background, text, border, and gradient utilities were removed from sprint targets in the touched scope.
- Command menu behavior and sidebar shell behavior work is now included as part of the same sprint baseline hardening:
  - `/` to open, grouped results, in-menu hints, and open-in-new-tab support.
  - Sidebar favorites and reorderability moved to Sprint 2 slice.
7. Re-run legacy class sweep and confirm zero hard fails.
