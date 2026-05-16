# ADR 0010 - Add DUE_TODAY Ageing Sub-Bucket

- **Status:** Accepted
- **Date:** 2026-05-16
- **Related:** `02_HANDOFF_SPEC.md` §D6, audit 2026-05-16
- **Supersedes:** none

## Context

`02_HANDOFF_SPEC.md` §D6 defines five ageing buckets:
`NOT_DUE | 0–30 | 31–60 | 61–90 | 90+`. The "0–30" bucket includes invoices
whose due date is today (`overdueDays === 0`).

In production, analysts and the CFO repeatedly asked to distinguish invoices
*due today* — the highest-leverage collection action of the day — from invoices
that are 1–30 days overdue. The Focus Queue and Today's Focus page already
elevate "Due Today" as a primary KPI, but the underlying bucket enum collapsed
this into `0_30`, forcing every consumer to recompute it from
`overdueDays === 0` against the snapshot's `as_of_date`.

## Decision

Introduce a sixth ageing bucket `DUE_TODAY` that splits out
`overdueDays === 0` from `0_30`. The bucket order is:

```
NOT_DUE → DUE_TODAY → 0_30 → 31_60 → 61_90 → 90_PLUS
```

Implementation: [src/server/ageing/buckets.ts](../../src/server/ageing/buckets.ts).

### Reporting semantics

For the purpose of `02_HANDOFF_SPEC.md` §13.3 ageing reports and the consolidated
dashboard:

- **Outstanding total** = `NOT_DUE + DUE_TODAY + 0_30 + 31_60 + 61_90 + 90_PLUS`.
- **Overdue total** = `0_30 + 31_60 + 61_90 + 90_PLUS` (DUE_TODAY is **not**
  overdue — the invoice is still on its credit terms).
- **Current (not overdue) total** = `NOT_DUE + DUE_TODAY`.

Exports (XLSX, party register) MUST present DUE_TODAY explicitly so totals
reconcile back to outstanding.

### CFO / external comparisons

When comparing against Tally `overdue_days` or Xero ageing reports (which use
the spec's five-bucket schema), DUE_TODAY is collapsed back into the *current*
column for backward compatibility. This is a display-only adapter applied in
the reconciliation view ([src/app/reconciliation/page.tsx](../../src/app/reconciliation/page.tsx)).

## Consequences

- Spec §D6 bucket enum extended by one value. Spec doc itself is not edited
  (per CLAUDE.md guardrail); this ADR is the source of truth for the deviation.
- All bucket-keyed UI (sidebar, dashboard, reports, status tag map, command menu,
  saved system views) recognises six values.
- Historical `invoice_snapshots` rows written before the change retain whatever
  bucket they had at publish time; ageing is recomputed at read time when
  needed (publish always uses the current `ageingBucket()` function).
- Reports that historically summed "overdue" stay correct as long as they
  exclude DUE_TODAY from the overdue total (verified in
  [src/app/reports/page.tsx](../../src/app/reports/page.tsx)).
