# Wireframes — M2 Task 6 handoff

These are static HTML+Tailwind mockups for Tejaswa's review. M4 (React dashboard build) is gated on sign-off here — see spec D23 and §13 consequence #16.

## How to view

Open each `.html` file directly in a browser. No build step, no server. All Tailwind classes load from CDN.

## Screens

| Code | File | Route | Roles |
|---|---|---|---|
| S1 | [S1-upload.html](S1-upload.html) | /upload | ANALYST, ADMIN |
| S2 | [S2-staging.html](S2-staging.html) | /staging/:snapshot_id | ANALYST, ADMIN |
| D1 | [D1-dashboard.html](D1-dashboard.html) | /dashboard | ALL (non-PENDING) |
| S5 | [S5-exceptions.html](S5-exceptions.html) | /exceptions | ANALYST, ADMIN |
| A6 | [A6-reconciliation.html](A6-reconciliation.html) | /admin/reconciliation | ANALYST (read), ADMIN |

## What each screen covers

**S1 — Upload:** drop zone (XLSX only), entity selector (IND/UAE), as-of date picker (required — Tally has no header date), source radio (Tally/Xero/Credit Period master, auto-detected but overridable), pre-flight check button with role tag, parse report preview panel (invoice count, PARSE_ERROR count, warnings, SHA-256, source), recent snapshots table with all 4 statuses (PARSING, STAGED, PUBLISHED, DISCARDED).

**S2 — Staging review:** breadcrumb, publish gate status panel (3 guards: party mapping, warnings acknowledged, role), PARSE_ERROR collapsible section (4 synthetic rows with reasons and raw JSON previews), warnings collapsible (GRAND_TOTAL_MISMATCH, UNALLOCATED_CREDITS_DELTA with acknowledge buttons), staging grid showing all 4 match states (exact alias, fuzzy ≥90%, fuzzy 70–89%, unmapped <70%), all 5 bucket colours, credit source tags (config/default/manual with tooltip on manual), publish/discard buttons with gate enforcement.

**D1 — Dashboard:** entity pills, KPI strip (5 tiles including FX rate with tooltip per D15/§7), ageing stacked bar chart with per-bucket ₹ totals, top-10 party table with Tally vs our overdue_days tooltip (spec §13 consequence #4), SVG trend sparkline (8 weeks), recent exceptions panel (all 4 D9 types + AUTO_RESOLVED), default credit period call-out widget (spec §13 consequence #5).

**S5 — Exceptions:** material-change review banner (3 invoices >5% amount change, spec consequence #2), 6 exception type summary cards (4 pre-seeded + 2 admin-added), filter bar, exception detail table (14 rows spanning all 4 D9 types + 2 admin types, statuses ACTIVE/RESOLVED/AUTO_RESOLVED, reason field prominent), tag invoice side panel shown open (exception type dropdown, mandatory reason textarea, expected resolution date, ANALYST/ADMIN role note).

**A6 — Reconciliation:** snapshot selector (last 8), publish gate warning with admin override button, 4 big value tiles (Dashboard AR computed, Exception bucket total computed, Tally/Xero closing AR user-entry field, Delta), MISMATCHED status badge with state legend, exception bucket breakdown table (by type, count, subtotal), analyst notes textarea, historical reconciliations table (8 snapshots with MATCHED/MISMATCHED/UNRECONCILED statuses).

## Review instructions for Tejaswa

Open each file, click around (buttons won't work — they're static), and note any changes needed. React implementation (M4) will follow the structure signed off here.

Key things to look at during review:

1. **S2 staging grid:** does the match-state UX (4 states, confirm/reject buttons, credit source badges) match what you'd expect analysts to use?
2. **D1 Tally overdue tooltip:** the "Tally: X / Ours: Y days" column — is the tooltip pattern clear enough for day-1 trust?
3. **A6 reconciliation formula:** the Delta tile shows the formula. Does "Dashboard AR + Exception total − Tally/Xero AR" read correctly for your mental model? (The formula comes from spec §13 consequence #6 — a write-off bucket reduces dashboard AR, so the delta should equal the exception total when Tally AR is gross.)
4. **S5 auto-resolve badge:** AUTO_RESOLVED rows are dimmed with an explanation. Confirm this is visible enough.
5. **Role indicators:** every action button has a role tag or note. Flag any that are missing or wrong.

Feedback in the M2 PR review.
