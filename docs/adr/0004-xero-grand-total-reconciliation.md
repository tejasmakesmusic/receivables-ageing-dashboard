# ADR-0004 — Xero grand-total reconciliation is a warning, not a blocking error

**Date:** 2026-04-17
**Status:** Accepted
**Context milestone:** M2 (parsers)
**Related:** spec §4.2, ADR-0003 (Tally counterpart), §13 consequence #6 (A6 reconciliation)

## Context

Spec §4.2 validation (pre-amendment) required:

> Grand total must match sum of invoice rows. Tolerance: AED 1.

When the M2 Task 3 Xero parser implementer inspected the real `MANTARAV_Aged_Receivables_Detail.xlsx` fixture, they found this rule is not satisfiable on a real Xero "Aged Receivables Detail" export:

| Quantity                                                 | Value                      |
| -------------------------------------------------------- | -------------------------- |
| Sum of invoice `Total` across 57 invoice rows            | AED 586,642.94             |
| Grand total row (`col0 = "Total"`, `Total` column value) | AED 0                      |
| Delta                                                    | AED 586,642.94 (≈100% off) |

The cause: Xero's "Aged Receivables Detail" report groups outstanding amounts into ageing bucket columns (`<1 Month`, `1 Month`, `2 Months`, `3 Months`, `Older`). The grand total row's `Total` column in this report format is the **net overdue** aged amount, not the sum of every invoice's `Total`. Future-dated or not-yet-due invoices contribute to invoice `Total` values but not to the overdue grand total.

Enforcing the original rule would cause every real Xero upload to fail `is_valid`, blocking publish.

## Decision

Amend spec §4.2 validation: emit `GRAND_TOTAL_MISMATCH` as a **warning** (non-blocking, in `result.warnings`), not as an error. `result.is_valid` stays True on a clean Xero upload. Per-row classification completeness (spec §4.1 re-amended pattern, ADR-0003 addendum) is the primary safety net: any row the parser cannot classify as `party_header` / `invoice` / `party_subtotal` / `grand_total` / `trailer` / `blank` is emitted as `StagedInvoice(status=PARSE_ERROR)` with a non-empty `parse_error_reason`.

## Consequences

**Positive:**

- Real Xero uploads can publish. Parser-bug detection comes from classification completeness, not an impossible sum-reconcile.
- Consistent with Tally parser behavior (ADR-0003 addendum). Single mental model across both formats.
- The warning itself still surfaces useful analyst context — a large mismatch between invoice totals and Xero's overdue grand total is meaningful hygiene data.

**Negative:**

- We lose the total-reconcile as a hard parser-bug invariant for Xero. A row-drop bug would be caught only by classification (if the dropped rows were previously classified correctly, the dropped rows wouldn't show up). Synthetic parser tests use strict grand-total reconciliation on hand-built files to cover this surface.

**Load-bearing for downstream:**

- M3 ingestion: publish gate (§5) already requires analyst to resolve PARSE_ERROR rows. Xero credit-note rows without `Invoice Number` emerge as PARSE_ERROR — analyst resolves (likely via "Credit note pending" exception tag from D9).
- M6 A6 reconciliation: `dashboard_ar` for the UAE entity will be gross per-invoice (sum of invoice `Total` values); `tally_xero_closing_ar` will be net (user-entered from Xero's accounts view, not this Aged Receivables report). The expected delta = future-dated invoice totals + any FX movement between invoice date and close date. Reconciliation screen should make this delta explicit.

## Alternatives considered

- **Keep as blocking error per original spec.** Real Xero uploads would never pass. Unusable.
- **Try to reconcile against sum of ageing-bucket columns.** Xero's ageing bucket sums would reconcile correctly to the grand total by construction, but they are computed by Xero using Xero's own due-date / ageing logic — which we intentionally replace with our own (spec §15: "Do not use Xero's due date for ageing"). Reconciling against Xero's ageing is tautological and provides no parser-bug detection value.
- **Skip the reconciliation entirely.** Loses the signal. Demoting to warning preserves the signal while unblocking uploads.

## Test consequences

`test_grand_total_mismatch_warning_synthetic` (M2 Task 3) constructs a file with a deliberate AED offset between sum-of-invoice-totals and the grand total row, and asserts:

- `GRAND_TOTAL_MISMATCH` appears in `result.warnings` (not `errors`).
- `result.is_valid is True`.
- `detail.delta` matches the synthetic offset exactly.

The real-fixture test asserts `result.is_valid is True` and allows a large `GRAND_TOTAL_MISMATCH` warning delta (expected per the grand-total-reflects-overdue-only Xero behavior).
