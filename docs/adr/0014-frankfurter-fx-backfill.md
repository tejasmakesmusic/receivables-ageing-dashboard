# 14. Frankfurter-backed FX rate backfill

Date: 2026-05-17

## Status

Accepted.

## Context

The dashboard consolidates every open invoice into INR at
[src/server/dashboard/service.ts:700](../../src/server/dashboard/service.ts).
That code looks up an `fx_rates` row covering each invoice's date and
throws 422 (`FX_RATE_MISSING`) when none exists. The `fx_rates` table
is currently empty across all pairs, so any non-INR invoice surfaced
to the dashboard breaks the response.

Manual entry via the admin UI (one row per pair per date) does not
scale to the historical depth we need — Mantarav alone has open
invoices going back to 2023-12-06, and other entities span similar
ranges. We need a programmatic feed.

Constraints from the locked spec / CLAUDE.md:
- "Mutate FX rows after creation" — forbidden. INSERT only.
- "Pin FX lookup by `invoice_date`" — the lookup column is
  `effective_from`, queried with `<=` ordered DESC. Backfilled rows
  must respect this semantic.
- `uq_fx_rates_pair_open` enforces a single `effective_to IS NULL` row
  per pair. We honor this by closing every historical row's
  `effective_to` at the day before the next published rate, leaving
  only the latest as the OPEN rate.

## Decision

Use frankfurter.app (ECB-backed, no API key, no rate limit) as the
canonical historical FX source for all non-AED pairs. For any pair
involving AED, derive the rate from the **UAE Central Bank's USD
peg** (1 USD = 3.6725 AED, fixed since November 1997) rather than
attempting to source AED quotes from frankfurter (which does not
publish them — AED is not in the ECB reference set).

Specifically:
- `AED → target` = `(USD → target) / 3.6725`
- `target → AED` = `(target → USD) × 3.6725`
- `AED ↔ USD` uses the constant peg with zero API calls.
- All other pairs hit frankfurter's `/timeseries` endpoint directly.

Inserted rows carry `source = 'API'`, `created_by = NULL`, and span
the date range MIN(invoice_date) for that source currency among
currently-open invoices → today. The `effective_to` column is set to
the day before the next published rate for every row except the most
recent, which remains NULL.

The backfill is invoked manually as a CLI:
```
npx tsx scripts/backfill-fx.mts
```
Idempotent — re-running skips dates that already exist (P2002 unique
violation is caught and counted as `skipped`).

## Consequences

- The dashboard's `lookupFxRate` succeeds for every open-invoice
  currency once the backfill has run; weekends/holidays are covered
  by the existing `effective_from <= invoice_date` fallback.
- AED rates are accurate to the peg; if the UAE Central Bank ever
  re-pegs, the constant `AED_PER_USD` in
  [src/server/fx/backfill.ts](../../src/server/fx/backfill.ts) must
  be updated and a fresh backfill issued for AED-involving pairs.
- The backfill cannot run for a pair that already has an OPEN
  (`effective_to IS NULL`) rate — the partial unique constraint
  blocks the insert and we are forbidden from updating the existing
  row. The script reports this pair as skipped with a clear reason.
- No scheduled job yet — analysts run the script when they notice a
  gap. A cron variant (daily fetch of yesterday's ECB rate plus
  derived AED) is a follow-up, out of scope for this ADR.
- Frankfurter is third-party and could deprecate the free tier. If
  that happens we swap implementations behind the `FrankfurterFetcher`
  interface; the rest of the system (column shapes, AED peg math,
  insert semantics) is provider-neutral.
