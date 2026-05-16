# ADR 0012 - Read-Only Xero API Ingestion

- **Status:** Accepted for planning
- **Date:** 2026-05-16
- **Related:** `02_HANDOFF_SPEC.md` section 1 (Phase 2 exclusions), section 2 D2/D3/D7/D8/D14/D19, section 15, ADR-0004, ADR-0005, ADR-0006
- **Supersedes:** none

## Context

`02_HANDOFF_SPEC.md` locks Phase 1 to manual workbook upload and explicitly
places direct Xero API integration out of scope. The current implementation
therefore parses Xero's `Aged Receivables Detail` workbook and stores snapshots
with `source_hint = "XERO"`.

Tejaswa approved exploring a Phase 2 direction where the UAE entity can pull
data directly from Xero instead of requiring a user-exported workbook.

The design constraint is important: Xero may become the source of source-system
records, but Receivables OS must remain the source of truth for EMB ageing,
credit-period resolution, exceptions, follow-ups, reconciliation, RBAC, audit,
and publish workflow.

## Decision

Add a read-only Xero connector as a Phase 2 ingestion path for UAE snapshots.
The connector will fetch Xero records, convert them into the same canonical
staging shape as the workbook parser, and then reuse the existing staging,
review, reconciliation, and publish pipeline.

The connector must not write back to Xero.

### Recommended source model

Use raw Xero accounting records as the import source:

- Sales invoices from Xero's invoices endpoint.
- Contacts from Xero's contacts endpoint for party matching and canonical party
  enrichment.
- Credit notes, payments, and overpayments only when needed to make the open AR
  and reconciliation story complete.
- Xero reports, including aged receivables reports, only as reconciliation or
  diagnostic evidence.

Do not use Xero's ageing buckets or Xero due dates for Receivables OS ageing.
Ageing remains:

```text
due_date = invoice_date + credit_days_applied
bucket = ageing_bucket(snapshot.as_of_date, due_date)
```

### Snapshot semantics

The first implementation should create a current-as-of snapshot at pull time.
It should not attempt historical backfill or historical AR reconstruction.

For each pull:

1. Analyst or ADMIN selects the UAE entity and starts "Pull from Xero".
2. Server verifies RBAC and that the Xero connection is active.
3. Server fetches current open Xero AR records, paginating and respecting rate
   limits.
4. Server writes a canonical JSON source artifact to the existing workbook
   evidence storage path, or an equivalent object-storage path, and records its
   SHA-256 on `snapshots.upload_file_sha256`.
5. Server creates a `STAGED` snapshot with `source_hint = "XERO"` for downstream
   compatibility.
6. Parser-equivalent normalization emits row-level `OK` or `PARSE_ERROR`
   staging records. No Xero row may be silently dropped.
7. Existing alias, credit-days, review, reconciliation, and publish gates run
   unchanged.

If manual Xero workbook upload remains available, distinguish the origin inside
`parse_result_json` with a field such as:

```json
{ "source_origin": "XERO_API" }
```

Do not add a new `source_hint` value unless the downstream enum/check constraint
is intentionally migrated.

### Auth and credentials

Use Xero OAuth 2.0. Do not use API-key assumptions.

Default to the standard OAuth web flow because Xero Custom Connections are
region-limited and must not be assumed for the UAE organisation. If the actual
Xero organisation is eligible for Custom Connections and Tejaswa approves the
monthly cost, Custom Connections can be a later simplification.

Required production secrets belong in Vercel environment variables:

- Xero client ID.
- Xero client secret.
- OAuth redirect URI.
- Token-encryption key, if tokens are stored in the database.

Never commit these secrets.

### Proposed data model

Add the minimum tables needed to keep the connector auditable and recoverable:

| Table | Purpose |
|---|---|
| `xero_connections` | One row per connected Xero tenant/entity, including tenant ID, tenant name, scopes, status, encrypted refresh token or custom-connection reference, connected_by, connected_at, disconnected_at. |
| `xero_sync_runs` | One row per pull attempt, including connection ID, snapshot ID, started_at, finished_at, status, pages fetched, row counts, rate-limit metadata, and error summary. |

Token material must be encrypted at rest. Application logs may include sync run
IDs and counts, but never raw invoice payloads, tokens, customer secrets, or
client data.

### RBAC and audit

- Only ADMIN can create, reconnect, or disconnect a Xero connection.
- ANALYST with UAE entity scope and ADMIN can trigger a read-only pull.
- CFO and PENDING users cannot trigger pulls or mutate connection settings.
- Every connection mutation and every pull-trigger action writes an `audit_log`
  row with before/after JSON where applicable.

### API surface

Recommended routes:

| Route | Method | Role | Purpose |
|---|---:|---|---|
| `/api/admin/xero/connect` | `GET` | ADMIN | Start OAuth authorization. |
| `/api/admin/xero/callback` | `GET` | ADMIN | Complete OAuth and store connection. |
| `/api/admin/xero/disconnect` | `POST` | ADMIN | Revoke/disable connection. |
| `/api/xero/snapshots/pull` | `POST` | ANALYST/ADMIN | Create a staged Xero snapshot. |

If a cron pull is added later, protect it with `CRON_SECRET` plus a Postgres
lock, matching the existing Vercel Cron pattern.

## Consequences

### Positive

- Removes the manual export/upload step for UAE receivables.
- Reduces workbook-format fragility and analyst handling effort.
- Keeps the existing staging and publish controls instead of creating a parallel
  ingestion workflow.
- Makes source-system provenance stronger if raw API responses are retained as
  immutable source artifacts.

### Negative

- Adds OAuth, token rotation, Xero outage handling, and rate-limit behavior to
  the production threat model.
- Some fields currently present in the workbook export may not map 1:1 from the
  API. Examples to validate before implementation: invoice seen/sent, project
  ID, service month, custom report columns, credit-note presentation.
- A current API pull is not the same as reconstructing "open as of an arbitrary
  past date." Historical backfill remains out of scope.
- The locked spec remains workbook-first; this ADR is the approved planning
  deviation and the spec itself is not edited.

## Alternatives considered

### A. Raw-record connector, then compute ageing locally

Recommended. This matches the product's custom credit-period and ageing rules
and keeps Xero reports as reconciliation evidence rather than business logic.

### B. Mirror Xero's aged receivables report

Not recommended. It would be faster to ship, but it imports Xero's ageing
semantics and repeats the same issues captured in ADR-0004: Xero report totals
and buckets do not align cleanly with Receivables OS ageing rules.

### C. Use an external integration platform

Not recommended for v1. It can reduce OAuth maintenance, but it adds another
vendor, another data boundary, and possible loss of source-level audit detail.

## Implementation plan outline

1. Build a Xero client wrapper with token refresh, pagination, retry-after
   handling, and structured errors.
2. Add connection and sync-run tables through Prisma migrations.
3. Add ADMIN-only connection UI and API routes.
4. Add a normalizer that maps Xero API responses into `ParsedInvoiceRow`-like
   staging records.
5. Add "Pull from Xero" beside the current upload path for UAE.
6. Reuse existing staging, alias, credit-day, review, reconciliation, publish,
   and audit flows.
7. Add focused tests with fixture JSON. Do not require live Xero credentials in
   the normal test suite.

## Verification expectations

Implementation PRs must include:

- Unit tests for Xero normalization, token refresh failure handling, and
  row-level parse/error staging.
- Route tests for ADMIN-only connection management and CFO/PENDING mutation
  denial.
- A fixture-based regression test proving the same open invoice can flow from
  Xero JSON to staged snapshot to publish without using Xero due date for
  ageing.
- Manual UAT against the Xero demo company before production credentials are
  connected.

## References checked

- Xero OAuth 2.0 and FAQ: `https://developer.xero.com/faq`
- Xero Accounting API SDK docs: `https://xeroapi.github.io/xero-node/accounting/index.html`
- Xero OpenAPI repository: `https://github.com/XeroAPI/Xero-OpenAPI`
- Xero pricing and API usage policy: `https://developer.xero.com/pricing`
