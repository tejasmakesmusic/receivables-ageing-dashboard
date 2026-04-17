# ADR-0003 — Tally grand-total reconciliation uses party sub-totals, not invoice pending_amounts

**Date:** 2026-04-17
**Status:** Accepted
**Context milestone:** M2 (parsers)
**Related:** spec §4.1, §5 (STAGING phase), §13 consequence #6 (A6 reconciliation)

## Context

Spec §4.1 rule 7 (pre-amendment) required:

> Total of extracted invoices must match Tally grand total row (bottom of sheet). Tolerance: ₹1. Fail upload if off by more.

When the M2 Tally parser implementer inspected the real `GrpBills.xlsx` fixture, they found that this rule is not satisfiable in practice on a real Tally export:

- Sum of invoice-level `pending_amount` across 291 invoice rows: **₹13,19,31,723.04**
- Grand total row `pending_amount` column: **₹9,19,82,807.24**
- Delta: **~₹3,99,48,915.80** (≈₹4 crore; ~43% of grand total)

This is not a rounding gap. The Tally "Pending Bills" report has three amount layers:

1. Invoice `opening_amount` — original invoice amount when raised.
2. Invoice `pending_amount` — outstanding against that specific invoice.
3. Party sub-total — the party's **net** balance including unallocated credits (advance receipts, journal entries) that Tally hasn't matched to specific invoices.

For some parties (e.g. "ADEEP LEISURE" in our fixture), invoice rows sum to ₹17.05 lakh but the party sub-total reads ₹0.80 — Tally holds unallocated advance receipts against the party that net out most of the invoice-level exposure. The grand total row sums the party sub-totals (net positions), not the invoice `pending_amount` values. Enforcing the original rule 7 would `is_valid=False` every real Tally upload.

## Decision

Amend spec §4.1 validation to reconcile party sub-totals against the grand total row, and demote the invoice-pending-vs-grand-total gap to an informational warning:

1. **Hard reconcile (blocking):** `sum(party_sub_total_row pending_amount) ≈ grand_total_row pending_amount` within ₹1. Violation → `GRAND_TOTAL_MISMATCH` in `errors`; `ParseResult.is_valid = False`. Intent: catch real parser bugs (dropped rows, miscategorized headers) while tolerating Tally's netting mechanics.
2. **Informational warning (non-blocking):** emit `code=UNALLOCATED_CREDITS_DELTA` with `detail={"sum_of_invoice_pending": ..., "grand_total": ..., "delta": ...}`. The delta is the book-level unallocated-credit exposure and is legitimately useful context for the analyst — it is not an error.
3. **Per-party check (unchanged from §4.1 rule 4):** sub-total vs invoice-sum mismatch → warning. Flags ADEEP-type parties individually so the analyst can decide whether to create an advance-receipt exception tag or leave it.
4. **Remove as_of_date validation from the parser.** Tally headers don't carry an `as_of_date` reliably. Parser leaves `ParseResult.as_of_date = None`. The M3 upload pipeline collects `as_of_date` from the form and performs the `invoice_dates ≤ as_of_date` check there.

## Consequences

**Positive:**
- Real Tally uploads can publish. The hard reconcile still catches parser bugs (if we drop rows or misread sub-totals, the party-subtotals-vs-grand-total check will fail).
- The unallocated-credit exposure is explicit rather than hidden. The analyst sees the delta on every upload and can investigate patterns (e.g. is it growing over time?).
- Per-party subtotal warnings surface ADEEP-type cases so the analyst can tag the party with an appropriate exception (e.g. "Credit note pending" from D9) during staging.

**Negative:**
- We lose the invoice-total-vs-grand-total check as a hard invariant. A bug that drops an entire party's invoices would still be caught by the party-subtotals-vs-grand-total reconcile (the dropped party's sub-total wouldn't be in the sum), so this is acceptable.
- `StagedInvoice.amount` remains the per-invoice `pending_amount` — it overstates exposure for parties with unallocated credits. Analyst resolves during M3 staging (per D8: manual override is part of the staging workflow) or during M6 A6 reconciliation.

**Load-bearing for downstream:**
- M3 (ingestion): upload form must collect `as_of_date`; pipeline enforces `invoice_date ≤ as_of_date` per row.
- M5 (exceptions): may need an "Unallocated credit" exception bucket type in addition to the D9-seeded set, or analysts can repurpose "Credit note pending". Decide when M5 is scoped.
- M6 (A6 reconciliation): the `dashboard_ar` figure will include unallocated-credit exposure at gross (per-invoice) level; the `tally_xero_closing_ar` will be net. The existing `delta` field in `reconciliation_entries` already accommodates this.

## Alternatives considered

- **Leave spec §4.1 rule 7 as-is.** Every real Tally upload would block on `GRAND_TOTAL_MISMATCH`, making the product unusable.
- **Drop grand-total reconciliation entirely.** Loses the parser-bug safety net; a silent row-drop bug could ship to production.
- **Warning-only on the original invoice-sum-vs-grand-total check.** Weaker signal; doesn't distinguish genuine Tally netting from a parser bug.

The chosen decision preserves the safety net while matching the real data shape.
