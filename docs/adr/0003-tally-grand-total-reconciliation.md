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

---

## Addendum — 2026-04-17 (same day)

**Status of original decision:** superseded (in part).

The first amendment (above) assumed `sum(party_sub_total_pending) ≈ grand_total_pending` on a real Tally GrpBills export. The M2 Task 2 implementer ran that check against the real `GrpBills.xlsx` fixture and found it also fails:

| Quantity | Amount |
|---|---|
| Sum of invoice `pending_amount` (291 invoice rows) | ~₹13.2 crore |
| Sum of party sub-total rows | ~₹11.4 crore |
| Grand total row | ~₹9.2 crore |

So there are **two** independent netting layers in Tally's report, not one:

1. **Party-level netting** — party sub-total nets unallocated credits (advance receipts, journal entries) against that party's invoice balances. `sum(invoice pending) - sum(party_subtotals) ≈ ₹1.8 crore`.
2. **Group-level netting** — grand total nets further entries above the party level (inter-group adjustments, group-scope unallocated entries). `sum(party_subtotals) - grand_total ≈ ₹2.3 crore`.

No sum-of-X == Y reconcile holds at the file level. The "hard reconcile" safety net is structurally unavailable from a Tally GrpBills report.

### Re-decision

Demote `GRAND_TOTAL_MISMATCH` from blocking error to non-blocking warning, and adopt **per-row classification completeness** as the primary safety net:

- Every non-metadata, non-grand-total row in the `Sundry Debtors` sheet must be classified as exactly one of: `party_header`, `invoice_row`, `party_subtotal`, or `blank`.
- Any row the parser cannot classify is emitted as `StagedInvoice(status=PARSE_ERROR, parse_error_reason=...)`. Analyst sees PARSE_ERROR rows in M3 staging; publish gate (§5) blocks publication until resolved.
- This is a stronger, more direct check than any sum-reconcile: if the parser drops rows, classification would skip or misclassify them, and either outcome surfaces. A sum-reconcile was only ever an indirect proxy for this invariant.

`GRAND_TOTAL_MISMATCH` remains as a **warning** so an analyst can see the party-subtotals-vs-grand-total gap (which is the group-level netting magnitude) and investigate if it ever looks structurally wrong (e.g. 10× the expected magnitude). It does not block publish.

`UNALLOCATED_CREDITS_DELTA` is unchanged — always emitted, always non-blocking, surfaces book-level unallocated-credit exposure per snapshot.

Spec §4.1 validation section updated in same commit as this addendum.

### Why not test the parser against invoice count / party count ranges?

Considered and rejected. Row count ranges would need per-entity calibration ("normal" count range) and would flag legitimate business changes (new clients onboarded, invoices settled in bulk). Classification completeness is objective and doesn't require calibration.

### Downstream impact of the re-decision

- **M3 ingestion:** unchanged. Publish gate already requires analyst to resolve PARSE_ERROR rows and acknowledge warnings (§5).
- **M5 exceptions:** may want to pre-seed an "Unallocated credit" exception bucket to complement D9's set. Decide when M5 is scoped.
- **M6 A6 reconciliation:** the `delta` between dashboard AR (gross per-invoice) and Tally closing AR (net) is now expected and explainable via `UNALLOCATED_CREDITS_DELTA` from the latest snapshot. Reconciliation screen should surface this delta directly.

### Reconcile signals — when each fires

Four warning codes surface reconciliation information from the Tally parser. None are blocking (`is_valid` stays True):

| Code | Fires when | What it surfaces |
|---|---|---|
| `SUBTOTAL_MISMATCH` | A party's sub-total row differs from the sum of that party's invoice `pending_amount` rows by > ₹1 | Party-level unallocated credits / advance receipts (ADEEP-type) |
| `GRAND_TOTAL_MISMATCH` | Grand total row detected AND `sum(party_subtotals) − grand_total > ₹1` | Group-level netting magnitude; useful analyst signal even when expected |
| `UNALLOCATED_CREDITS_DELTA` | Grand total row detected (always, on such files) | Book-level gross vs net gap: `sum(invoice pending) − grand_total`; non-zero = unallocated credits exist |
| `GRAND_TOTAL_ROW_NOT_DETECTED` | No subtotal-shaped row found in the sheet (edge case: truncated file or changed format) | Parser cannot reconcile at all; analyst must verify file completeness |

`GRAND_TOTAL_MISMATCH` and `UNALLOCATED_CREDITS_DELTA` are mutually exclusive with `GRAND_TOTAL_ROW_NOT_DETECTED` — the first two require a detected grand total row; the last fires precisely when none is detected.

### Test consequences

The `test_grand_total_mismatch_error_synthetic` test name retains "error" for historical clarity but asserts the mismatch appears in `result.warnings` (not `result.errors`) and that `result.is_valid` stays True. The test is still a meaningful parser-bug detector: a synthetic file with a ₹50 offset between party-subtotals-sum and grand-total still triggers the warning.

The `test_grand_total_row_not_detected_synthetic` test (added in M2 branch cleanup) builds a file with only invoice rows and no subtotal-shaped rows. It asserts: `GRAND_TOTAL_ROW_NOT_DETECTED` in `result.warnings`; no `GRAND_TOTAL_MISMATCH`; no `UNALLOCATED_CREDITS_DELTA`; `result.is_valid == True`.
