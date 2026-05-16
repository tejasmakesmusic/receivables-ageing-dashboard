# 13. Derived base-currency amount on `invoices`

Date: 2026-05-17

## Status

Accepted.

## Context

Xero's "Aged Receivables Detail" report converts every foreign-currency
invoice into the org's base currency before printing totals. Our
ingestion pipeline preserves the **source-currency** `AmountDue` exactly
as Xero returns it and stores the per-invoice exchange rate from Xero's
`CurrencyRate` field into `invoices.xero_metadata.currency_rate`. The
conversion is never applied downstream, so reconciling a published
snapshot against the AR Detail report requires a join + multiplication
that lives in nobody's head.

This came up on 2026-05-17 reconciling Mantarav (UAE) against the AR
Detail dated 16 May 2026: the Excel grand total is AED 355,330.21 but
the staged total ran higher because (a) DRAFT/SUBMITTED invoices were
not filtered (fixed separately in `normalizer.ts`) and (b) USD invoice
`26-27/UAE/015` was being summed at its USD figure rather than its
AED-converted 1,909.70.

Xero's `CurrencyRate` is a per-invoice multiplier from source currency
to org base currency, locked at posting time. Xero does not retroact
when later rates change, which makes it the right number for
GL-matching reconciliation — we should not substitute our internal FX
table for this purpose.

## Decision

Add a nullable `invoices.amount_base NUMERIC(18, 2)` column populated
at publish time:

- `source_currency == entity.base_currency` → `amount_base = amount`.
- `source_currency != entity.base_currency` and Xero `currency_rate`
  is present → `amount_base = amount × currency_rate`.
- Otherwise → `amount_base = NULL`. This covers Tally and manual
  spreadsheet rows, which do not carry a per-row FX rate today.

The column is **nullable** and **not backfilled** (per the locked
"never auto-backfill historical data" rule). Republishing an existing
snapshot will populate it; rows from older snapshots stay NULL until
their snapshot is republished.

`amount` continues to hold the source-currency figure — that field is
authoritative for invoice identity and analyst overrides. `amount_base`
is purely derived and exists to make the AR-report reconciliation a
single column read.

## Consequences

- Reports that need to reconcile against Xero AR Detail (or any other
  org-base-currency report) can sum `amount_base` directly.
- Code paths that read `amount` for invoice display continue to show
  source currency — no behavior change for analysts viewing
  individual invoices.
- `invoice_changes` does NOT diff `amount_base` because it is a pure
  function of `amount` and `currency_rate`. Diffing `amount` already
  signals the underlying change; diffing the derived column too would
  produce duplicate noise on every cross-currency invoice republish.
- Non-Xero source rows have NULL `amount_base` until a per-row FX
  pull is added for those sources. Sums must filter NULLs explicitly
  rather than coerce them to zero, otherwise totals will silently
  understate.
