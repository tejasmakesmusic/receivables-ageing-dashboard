# Credit Days UX — Entity Default Config + Staging Pre-check

**Date:** 2026-05-15
**Scope:** Three related improvements to the credit-days resolution UX.

---

## Problem

`resolveCreditDays` (service.ts:2040) runs a waterfall at **publish time**:

1. MANUAL — per-row `credit_days_override` set by analyst
2. CONFIG — `credit_period_config` row covering the invoice date for this canonical party
3. DEFAULT — `entities.default_credit_days` (non-null)
4. **422 `credit_days_missing`** — none of the above

Two UX problems:
- The 422 only surfaces when the analyst clicks Publish. They don't know which rows are affected until it's too late.
- `entities.default_credit_days` has no edit UI, so analysts can't set the entity-wide fallback without a direct DB write.

---

## A — Resolution chain (documentation only, no code change)

The chain is correct as implemented. No schema migration required — `entities.default_credit_days Int?` already exists in Prisma.

---

## B — Entity default in config UI

### What

A new "Entity Settings" card on `/config` showing each entity's `default_credit_days`. ANALYST and ADMIN can edit inline; REVIEWER and CFO see the table read-only.

### Data flow

```
/config page (Server Component)
  └─ listEntityDefaults(currentUser)          ← new: src/server/config/entityDefaults.ts
       └─ prisma.entities.findMany({ select: { id, code, name, default_credit_days } })

EntityDefaultsCard (Client Component)         ← new: src/app/config/_components/entity-defaults-card.tsx
  └─ inline edit form per row
       └─ PATCH /api/config/entity-defaults/[entityId]   ← new route
            └─ updateEntityDefault(entityId, days, currentUser)
                 ├─ RBAC: ANALYST | ADMIN only (403 otherwise)
                 ├─ prisma.entities.update({ default_credit_days })
                 └─ audit_log write (before_json / after_json)
```

### API contract

`PATCH /api/config/entity-defaults/[entityId]`
- Body: `{ default_credit_days: number | null }`
- Success 200: `{ id, code, name, default_credit_days }`
- 403: role not permitted
- 422: `default_credit_days` not a non-negative integer (when non-null)

### Files

| Action | Path |
|--------|------|
| New | `src/server/config/entityDefaults.ts` |
| New | `src/app/api/config/entity-defaults/[entityId]/route.ts` |
| New | `src/app/config/_components/entity-defaults-card.tsx` |
| Edit | `src/app/config/page.tsx` — import and render `EntityDefaultsCard` |

---

## C — Per-row staging pre-check

### What

During `buildStagingRows`, flag each `OK` invoice row that would fail `resolveCreditDays` at publish. Surface these as a dedicated filter tab and a publish gate blocker.

### Server changes

**`buildStagingRows` (service.ts:1287)**

1. Extend the parallel prefetch to also select `default_credit_days` from `entities` (currently only selects `require_review_before_publish`).
2. After `invoiceRows` is built, collect every distinct canonical ID with a resolved party (override or EXACT alias). Run one `credit_period_config.findMany` with `canonical_id IN [...]`. Build a `Map<canonicalId, DateRange[]>` in memory.
3. For each `OK` row with a resolved canonical ID and no `credit_days_override`: check if any config range covers its `invoice_date`. If not and `entity.default_credit_days` is null → `no_credit_days: true`. Otherwise `false`.
4. Rows with `status !== "OK"` or no resolved canonical ID: `no_credit_days: false`. These are already blocked by existing gate checks (parse errors, unmapped, fuzzy). We cannot pre-check credit days for unresolved rows because the canonical ID is unknown.

**`StagingInvoiceRow` interface** — new field:
```ts
no_credit_days: boolean
```

**`PublishGate` interface** — new field:
```ts
credit_days_missing_count: number
```

**`gateFromRows`** — include `credit_days_missing_count` in the gate; add it to the `ok` predicate:
```ts
ok: rolePermits && ... && credit_days_missing_count === 0 && !reviewBlocks
```

### UI changes

**`staging-data-table.tsx`**
- New filter tab: `{ label: "No Credit Days", value: "no_credit_days" }` — always shown (consistent with "Parse Errors" which is also always shown). Tab will be empty when no rows are affected.
- Rows where `no_credit_days === true`: render a `NO CREDIT DAYS` badge (danger variant) alongside the existing resolution-state badge.

**`filterStagingRows`**
- New branch: `if (filter === "no_credit_days") return rows.filter(r => "no_credit_days" in r && r.no_credit_days)`

**`staging-publish-panel.tsx`**
- New `GateBlockerItem`: `{gate.credit_days_missing_count} rows missing credit days` (shown when count > 0).

### Files

| Action | Path |
|--------|------|
| Edit | `src/server/snapshots/service.ts` — `buildStagingRows`, `gateFromRows`, `StagingInvoiceRow`, `PublishGate` |
| Edit | `src/app/snapshots/[snapshotId]/staging/_components/staging-data-table.tsx` |
| Edit | `src/app/snapshots/[snapshotId]/staging/_components/staging-publish-panel.tsx` |

---

## RBAC summary

| Action | ANALYST | ADMIN | REVIEWER | CFO | PENDING |
|--------|---------|-------|----------|-----|---------|
| View entity defaults | ✓ | ✓ | ✓ | ✓ | — |
| Edit entity defaults | ✓ | ✓ | — | — | — |

---

## Audit log

Every `PATCH /api/config/entity-defaults/[entityId]` writes one `audit_log` row:
- `action`: `"entity_default_credit_days_updated"`
- `before_json`: `{ default_credit_days: <old value> }`
- `after_json`: `{ default_credit_days: <new value> }`
- `performed_by`: session user ID

---

## Out of scope

- Per-row credit-days override UI in staging (already implemented via `credit_days_override` field)
- "Parties on default credit period" report (spec §13.5 — separate initiative)
- Weekly email nudge for parties on default credit period (same)
