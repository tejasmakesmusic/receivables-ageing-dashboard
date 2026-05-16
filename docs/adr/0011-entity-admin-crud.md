# ADR 0011 - Admin CRUD for Entities Beyond IND/UAE

- **Status:** Proposed
- **Date:** 2026-05-16
- **Related:** `02_HANDOFF_SPEC.md` §2 (entity model), §13.3 (consolidated dashboard), §15 (RBAC)
- **Supersedes:** none

## Context

`02_HANDOFF_SPEC.md` §2 describes two entities (`IND`, `UAE`) with hardcoded
base currencies (INR, AED) and country codes. The implementation reflects this
literally:

- Zod enums of `["IND", "UAE"]` in validation layers:
  - [src/server/config/creditPeriod.ts:13](../../src/server/config/creditPeriod.ts#L13)
  - [src/server/config/aliases.ts](../../src/server/config/aliases.ts)
  - [src/server/snapshots/service.ts](../../src/server/snapshots/service.ts)
  - [src/server/parsers/credit-period.ts](../../src/server/parsers/credit-period.ts)
  - [src/server/lobs/service.ts](../../src/server/lobs/service.ts)
- Consolidated dashboard hardcodes the iteration in
  [src/server/dashboard/service.ts:683](../../src/server/dashboard/service.ts#L683)
  (`for (const entityCode of ["IND", "UAE"] as const)`).
- The seed file [prisma/local-seed.sql](../../prisma/local-seed.sql) inserts
  exactly these two rows; there is no admin page to add a third.
- The consolidated ("ALL") dashboard currently converts AED → INR for display.
  No FX strategy exists for a third currency.

Today (2026-05-16) the analyst team asked to add and manage entities from the
admin panel. This ADR exists to scope that change and surface the trade-offs
before implementation begins.

## Decision (proposed — not yet accepted)

Add an admin-only CRUD surface at `/admin/entities` that lets ADMINs create,
edit, and deactivate entities. Replace the hardcoded `IND`/`UAE` literals with
data-driven lookups, retaining a small adapter for back-compat with the spec's
two-entity language.

### Scope

**In scope:**

1. **Schema** — `entities` table already supports arbitrary rows; no migration
   needed. Audit columns (`created_by`, `updated_by`) should be added if not
   present.
2. **API** — `POST /api/admin/entities`, `PATCH /api/admin/entities/:id`,
   `POST /api/admin/entities/:id/deactivate`. All ADMIN-only, audit-logged.
3. **UI** — `/admin/entities` page mirroring the LOBs admin page pattern:
   list + create form + per-row Edit/Deactivate. RBAC: ADMIN only.
4. **Validation layer** — replace `z.enum(["IND", "UAE"])` with a runtime
   lookup that fetches the active entity-code set from the DB once per
   request (cached in the request scope). All affected modules listed above.
5. **Consolidated dashboard** — replace the hardcoded iteration with
   `entities.findMany({ where: { active: true } })`. Order by `code` for
   stable output.
6. **FX strategy** — see "Open question" below.

**Out of scope:**

- Renaming or deleting an existing entity. Codes are immutable once invoices
  reference them (FK from `invoices.entity_id`). Deactivation hides an
  entity from new uploads but preserves historical data.
- Per-entity locale / number-format settings. Defer until a third entity
  actually needs it.
- Multi-region pricing or tax rules.

### Open question: consolidated-dashboard FX

The "ALL" view at [src/server/dashboard/service.ts:654](../../src/server/dashboard/service.ts#L654)
converts every entity's outstanding to INR. With a third currency (say USD)
there are three viable patterns:

| Option | Description | Trade-off |
|---|---|---|
| **A. Pin INR as the reporting currency** | Every new entity adds an FX rate row; consolidated stays in INR. | Simple, no UI change. Bad UX if reporting moves abroad. |
| **B. Per-user reporting currency** | New user setting; consolidated converts to that currency. | Clean. Requires FX coverage for every (from, to) pair. |
| **C. Per-entity-pair native, no consolidation** | Drop the "ALL" view; force IND/UAE/USD tabs. | Honest but loses the "one number" KPI on the home page. |

**Recommendation:** A for v1 (zero UI work), revisit if a non-INR-thinking
stakeholder appears.

### Decision matrix

| Question | Recommendation |
|---|---|
| Allow ADMIN to create new entities? | Yes |
| Allow editing `code` after creation? | No (immutable; FK target) |
| Allow editing `name`, `country`, `base_currency`, `default_credit_days`, `require_review_before_publish`? | Yes |
| Allow deletion? | No — soft deactivate only |
| Show inactive entities in dropdowns? | No (filter at query time) |
| Block deactivation if entity has OPEN invoices? | Yes — surface the count, require explicit confirmation |
| Per-entity RBAC scope (`users.entity_id_scope`)? | Already exists; extend dropdown to include new entities |
| Seed new entities in test fixtures? | No — keep seed at IND/UAE; tests create their own |

## Consequences

### Positive

- Spec §2's two-entity assumption becomes data, not code. Adding a fourth or
  fifth entity is a UI action, not a deploy.
- Removes ~5 `z.enum(["IND","UAE"])` literals and one hardcoded iteration —
  net less code to keep in sync.
- The audit-log already covers admin mutations; entity changes get the
  same trail for free once the API routes write audit rows.

### Negative

- `02_HANDOFF_SPEC.md` still talks about "IND and UAE entities" in several
  sections. This ADR is the source of truth for the deviation, per the same
  pattern as ADR 0010. The spec doc itself is not edited.
- Tests that mock entities by code string need to be reviewed — most
  reference IND/UAE by literal, which still works but is brittle.
- The consolidated dashboard becomes slightly slower (one extra query per
  request) until cached.
- FX coverage gaps become more visible. Today a missing AED→INR rate breaks
  ALL view; a third currency multiplies that risk.

### Migration

1. Land the API + UI behind an ADMIN-only feature flag (env var) so it can
   be enabled in production without surfacing to analysts.
2. Refactor the Zod enums one file at a time; each commit re-runs typecheck
   + lint and the existing test suite.
3. Update the consolidated dashboard last, after entity-list caching is in
   place.
4. Remove the feature flag once the admin team is comfortable.

### Estimated effort

~3-5 working days for the full scope above, split:

- 0.5 day — API + audit log
- 0.5 day — `/admin/entities` UI
- 1.5 days — Zod-enum refactor + tests across all affected modules
- 1 day — consolidated dashboard refactor + FX coverage gap UX
- 1 day — manual QA, ADR finalisation

## Alternatives considered

**Keep IND/UAE hardcoded and add a config table for "labels only".** Avoids
the refactor but leaves the codebase dishonest: the UI shows a third entity
that no validation layer can route to. Rejected.

**Make `entities.code` editable so existing codes can be renamed.** Simpler
mental model but breaks FK integrity and requires a data migration on every
rename. Rejected — code-as-immutable-id is standard.

**Defer entirely.** Accept that the project ships with two entities forever.
Reasonable if the customer-facing roadmap never needs a third entity, but
the request is concrete and recent. Not recommended.
