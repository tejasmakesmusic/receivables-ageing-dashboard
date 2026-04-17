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
| A6 | [A6-reconciliation.html](A6-reconciliation.html) | /admin/reconciliation | AR entry role pending spec clarification (see Open spec questions above) |

## Open spec questions (flagged for Tejaswa before M6)

### A6 reconciliation: who enters the Tally/Xero closing AR?

Spec is internally contradictory:

- **§2 D19** — "Analyst enters actual Tally/Xero closing AR per snapshot."
- **§9 route matrix** — A6 is `ANALYST (read), ADMIN` (i.e. ADMIN writes).

These cannot both be true. M2 wireframe A6 uses role-neutral copy for the
AR-entry control pending clarification. M6 implementation blocked on this:

- If D19 is authoritative: flip the route matrix to `ANALYST (write), ADMIN`.
- If §9 route matrix is authoritative: amend D19 to `ADMIN enters closing AR`.

No decision inferred here. Requires Tejaswa's call before M6 starts.

---

## What each screen covers

**S1 — Upload:** upload-type selector at the top branches between (a) **transactional snapshot** (Tally/Xero → staging → publish, with entity selector IND/UAE, as-of date picker, source radio Tally/Xero, pre-flight check) and (b) **credit-period master** (config import, expects sheets `India` + `UAE` in one XLSX, no entity selector, no as-of date, no staging step; D20 note that UAE `Amount` column is not persisted). Parse report preview panel covers invoice count, PARSE_ERROR count, warnings, SHA-256, source. Recent uploads table shows all 4 snapshot statuses (PARSING, STAGED, PUBLISHED, DISCARDED) plus `CREDIT_PERIOD` imports with a "View config diff" action link.

**S2 — Staging review:** breadcrumb, publish gate status panel (**4 guards:** party mapping, warnings acknowledged, PARSE_ERROR rows resolved, role), PARSE_ERROR collapsible section (4 synthetic rows with reasons and raw JSON previews), warnings collapsible (GRAND_TOTAL_MISMATCH, UNALLOCATED_CREDITS_DELTA with acknowledge buttons), staging grid showing all 4 match states (exact alias, fuzzy ≥90%, fuzzy 70–89%, unmapped <70%), all 5 bucket colours, credit source tags (config/default/manual with tooltip on manual), publish/discard buttons with gate enforcement.

**D1 — Dashboard:** entity pills (IND / UAE / Consolidated — D1 is the only screen that supports Consolidated per D15), KPI strip (5 tiles including FX rate with tooltip per D15/§7), ageing stacked bar chart with per-bucket ₹ totals, top-10 party table with Tally vs our overdue_days tooltip (spec §13 consequence #4) and an Exception tags column (badge + tag types, links to S5), SVG trend sparkline (8 weeks), recent exceptions panel (all 4 D9 types + AUTO_RESOLVED), default credit period call-out widget (spec §13 consequence #5).

**S5 — Exceptions:** explainer banner on exception vs follow-up separation (D12), material-change review banner (3 invoices >5% amount change, spec consequence #2), 6 exception type summary cards (4 pre-seeded + 2 admin-added), filter bar (entity filter is IND/UAE multi-select — no Consolidated), exception detail table (14 rows spanning all 4 D9 types + 2 admin types, statuses ACTIVE/RESOLVED/AUTO_RESOLVED, reason field prominent, new "Last follow-up" column with hand-off link to S6 where absent), tag invoice side panel shown open (exception type dropdown, mandatory reason textarea, expected resolution date, ANALYST/ADMIN role note).

**A6 — Reconciliation:** snapshot selector (last 8), publish gate warning with admin override button, 4 big value tiles (Dashboard AR computed, Exception bucket total computed, Tally/Xero closing AR user-entry field, Delta), MISMATCHED status badge with state legend, exception bucket breakdown table (all ACTIVE exception tags on OPEN invoices in this snapshot, with seeded / admin-added row annotations), analyst notes textarea, historical reconciliations table (8 snapshots with MATCHED/MISMATCHED/UNRECONCILED statuses). AR-entry control carries role-neutral copy pending the D19 vs §9 permission clarification (see "Open spec questions" above).

## Review instructions for Tejaswa

Open each file, click around (buttons won't work — they're static), and note any changes needed. React implementation (M4) will follow the structure signed off here.

Key things to look at during review:

1. **S2 staging grid:** does the match-state UX (4 states, confirm/reject buttons, credit source badges) match what you'd expect analysts to use?
2. **D1 Tally overdue tooltip:** the "Tally: X / Ours: Y days" column — is the tooltip pattern clear enough for day-1 trust?
3. **A6 reconciliation formula (spec D19):** the Delta tile shows `Delta = Dashboard AR + Exception buckets − Tally/Xero AR`. When MATCHED, delta ≈ 0 → Tally/Xero closing AR equals Dashboard AR (gross per-invoice) + Exception buckets. Dashboard AR is gross (includes exception-tagged); Tally AR is net (books have already removed write-offs); exception buckets bridge the gap. The MISMATCHED scenario is snapshot #3418 with Delta = +₹1.28 Cr (Dashboard ₹18.72Cr + Exceptions ₹5.50Cr − Tally ₹22.94Cr).
4. **S5 auto-resolve badge:** AUTO_RESOLVED rows are dimmed with an explanation. Confirm this is visible enough.
5. **Role indicators:** every action button has a role tag or note. Flag any that are missing or wrong.

Feedback in the M2 PR review.
