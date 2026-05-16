# 15. Narrow exception: setting `fx_rates.effective_to` to close an open rate

Date: 2026-05-17

## Status

Accepted.

## Context

ADR-0014 added a programmatic FX backfill. The follow-up — a daily cron
that appends yesterday's rate — needs to **close** the currently-OPEN
row for a pair (the one with `effective_to IS NULL`) when it inserts a
new latest rate, otherwise the `uq_fx_rates_pair_open` partial unique
constraint blocks the insert.

CLAUDE.md says "Mutate FX rows after creation" — never. That rule
exists to prevent analysts from retroactively editing a rate that has
already participated in a published reconciliation: if `rate`,
`effective_from`, `from_ccy`, or `to_ccy` could change, our audit
trail would lie about what conversion actually ran on which date.

`effective_to` is different in kind. It does not change what a rate
**was** — only when it stopped being the current rate. It is
annotation, not economic state.

Pre-this-ADR, the codebase has no UPDATE path on `fx_rates` at all
(see [`assertFxImmutable`](../../src/server/core/assertFxImmutable.ts)
which throws 405 on any mutation attempt), so honoring the rule
without exception forced manual analyst intervention for every daily
rate append. That doesn't scale, and was the reason the daily cron was
called out as out-of-scope in ADR-0014.

## Decision

Carve out a single narrow exception: a service function
`closeOpenFxRate({ from_ccy, to_ccy, close_at })` may set
`effective_to` on a row where it is currently `NULL`, provided:

1. **Only `effective_to` is touched.** Rate, dates, currencies, source,
   created_by, created_at are never written.
2. **The target row must be currently OPEN** (`effective_to IS NULL`).
   If not OPEN, the call is a no-op (idempotency).
3. **`close_at` must be strictly between** the row's `effective_from`
   and any next-published rate's `effective_from`. The function
   computes the next rate's `effective_from` inline and rejects values
   outside that band — preventing accidental "shortening" of an
   already-historical row.
4. **Every closure writes an `audit_log` row** with `before = {
   effective_to: null }` and `after = { effective_to: <value> }`, so
   the immutability of the economic fields remains observably true
   from the audit log.

All other UPDATE paths on `fx_rates` remain forbidden;
`assertFxImmutable` still throws on attempts to modify any other field.

## Consequences

- The daily backfill cron can append rates without manual analyst
  intervention. The previously-OPEN row gets `effective_to = newRow.effective_from - 1 day`, the new row becomes OPEN.
- Audit log gains one new event type (`fx_rate.close`) per pair per
  daily cron tick. That's roughly 365 events/pair/year — well below
  the noise floor for any analyst-facing audit query.
- The economic immutability guarantee (rate, effective_from,
  currencies don't change after creation) is unchanged. Any analyst or
  auditor reviewing "what rate ran on date D for pair X→Y" gets the
  same answer forever.
- A future migration could drop `assertFxImmutable` in favor of a DB
  trigger that enforces the same field-level immutability if we ever
  want defense-in-depth. Out of scope here.
