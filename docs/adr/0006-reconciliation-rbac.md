# ADR-0006 — Reconciliation RBAC (resolve D19 vs §9 contradiction)

**Date:** 2026-04-19
**Status:** Accepted
**Context milestone:** M6-full (A6 permission contradiction flagged in `wireframes/README.md § Open spec questions`).
**Related:** spec D19 (reconciliation formula + analyst authorship), §9 (stated ANALYST read / ADMIN write), `docs/superpowers/plans/2026-04-18-m4-m6-ship-today.md` (temporary ADMIN-only shim used for M6-MVP).

## Context

Spec D19 positions the reconciliation flow as an analyst workflow ("analyst enters the Tally/Xero closing AR, system computes delta"). §9 tabulates the routes with ANALYST read / ADMIN write. The A6 wireframe inherited §9's table, but the workflow per D19 is analyst-owned.

The M6-MVP shipped with an ADMIN-only write as a temporary measure pending resolution. This ADR records the resolution so M6-full / M7 / M8 can close out cleanly.

## Decision

Reconciliation RBAC follows the same hierarchy used by every other mutation in the app:

| Role | GET `/snapshots/{id}/reconciliation` | POST `/snapshots/{id}/reconciliation` |
|---|---|---|
| ANALYST | ✅ (entity-scoped) | ✅ (entity-scoped — must match `entity_id_scope`) |
| ADMIN | ✅ (any entity) | ✅ (any entity) |
| CFO | ✅ (any entity, read-only) | ❌ 403 |
| PENDING | ❌ 403 | ❌ 403 |

**Principle:** ADMIN ⊇ ANALYST for permissions. ADMIN does everything ANALYST does plus "any entity" scope. CFO is read-only across the board. PENDING has no access until approved.

## Consequences

**Positive:**
- Matches D19's authorial intent — analysts actually own reconciliation.
- Consistent with every other mutation's RBAC (publish, staging patches, exception CRUD, follow-ups).
- §9's table row for A6 is reinterpreted as "at-minimum" — ADMIN writes is a subset; ANALYST writes is the normal case. No spec edit required because D19 and §9 were contradictory on this route only.

**Negative / trade-offs:**
- A CFO who wants to submit the closing AR must go through an ANALYST or ADMIN. This is the intended guard: CFOs approve, analysts reconcile.
- Audit trail responsibility shifts to ANALYST. This was already the implicit design per D19; we now enforce it.

**Load-bearing for downstream:**
- `backend/src/app/api/routes/snapshots.py::upsert_reconciliation` uses the `_allowed = require_role(Role.ANALYST, Role.ADMIN)` dep (same dep as all other write routes in that file).
- `backend/src/app/services/reconciliation_service.py::create_or_update_reconciliation` enforces ANALYST entity scope (mirrors `publish_service._check_rbac_and_entity_scope`).
- `CLAUDE.md` + `AGENTS.md` "Known gaps" removes the A6 pending-call item.
- `wireframes/README.md § Open spec questions` — mark A6 resolved with pointer to this ADR.

## Alternatives considered

- **Keep ADMIN-only.** Rejected: contradicts D19's analyst-authorship premise; adds an approval bottleneck for routine monthly reconciliation.
- **Allow CFO write.** Rejected: CFOs review and sign off; the write action is the system of record for the analyst's number. Letting the reviewer enter their own number breaks the segregation-of-duties story §9 gestures toward.
- **Let CFO write but flag `entered_by` differently.** Rejected: more complexity than the situation warrants. The ADR is the simpler answer.
