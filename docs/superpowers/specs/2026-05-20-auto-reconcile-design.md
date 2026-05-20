# Auto-Reconcile Design

**Date:** 2026-05-20  
**Status:** Approved  
**Branch:** main

## Context

The original spec (D19) required analysts to manually enter Tally/Xero closing AR per snapshot so the system could compute a delta against the dashboard AR. This is redundant: the uploaded file IS the Tally/Xero source, so `snapshot.total_outstanding` already contains the reference total. There is no separate "closing AR" for a user to enter — the data reconciles itself.

## Decision

Replace the manual reconciliation flow with on-the-fly auto-reconciliation. No user input. No DB writes for standard reconciliation. The system computes MATCHED/MISMATCHED by comparing `dashboard_ar` (sum of published `invoice_snapshots`) against `snapshot.total_outstanding` (grand total from the uploaded file).

## Scope

- `src/server/snapshots/service.ts` — `getOrComputeReconciliation`
- `src/app/snapshots/[snapshotId]/page.tsx` — Reconciliation card + ProgressPath step
- `src/app/snapshots/[snapshotId]/_components/reconciliation-form.tsx` — **delete**

Not in scope: DB schema changes, publish flow, admin reconciliation page, API routes.

## Service Layer

### `getOrComputeReconciliation` fallback path

Current behaviour when no `reconciliation_entries` row exists: return `status: "UNRECONCILED"`, `delta: null`, `tally_xero_closing_ar: null`.

New behaviour:

| `entry` | `snapshot.total_outstanding` | Result |
|---------|------------------------------|--------|
| exists  | any                          | Use stored entry (manual admin override wins) |
| null    | not null                     | Auto-compute: `delta = dashboardAr − total_outstanding`, status = MATCHED/MISMATCHED, `entered_by = null`, `entered_at = null` |
| null    | null                         | Return `UNRECONCILED` (edge case: file had no grand total) |

The existing `reconciliationStatus` function (tolerance-based MATCHED/MISMATCHED) is reused unchanged.

**Why a different formula from manual reconciliation:** The manual `upsertReconciliation` flow uses `dashboardAr + exceptionBucketTotal − tallyAr`. In that context, `dashboardAr` was conceptually "clean AR" and exception buckets were added back to equal the Tally system balance. In the code however, `dashboardAr` already includes all invoices (including exception-tagged ones), making that formula incorrect for auto-reconcile. For auto-reconcile the check is purely "did parsing capture all rows from the file?" — `dashboardAr − total_outstanding` is the right signal.

The function signature, return type (`ReconciliationResponse`), and 409 guard (PUBLISHED-only) are unchanged.

## UI — Snapshot Detail Page

### Reconciliation card

Rename the card title from "Reconciliation" to "Data Integrity". Replace the 6-field read-only `dl` with:

- Row 1 (3 columns): **Dashboard AR** | **Source File Total** | **Delta**
- Row 2 (full width): Status banner

Status banner variants:

| Status | Style | Message |
|--------|-------|---------|
| MATCHED | Green (current-border/bg/text tokens) | "Auto-reconciled — dashboard matches source file" |
| MISMATCHED | Amber/red (danger tokens) | "Mismatch: {delta} gap between dashboard and source file" |
| UNRECONCILED | Muted neutral | "Source file total unavailable — reconciliation skipped" |

Card is only rendered when `snapshot.status === "PUBLISHED"`. For STAGED/DISCARDED snapshots the card is omitted entirely.

The `ReconciliationForm` client component is deleted (was never wired to the page; now permanently unused).

### ProgressPath "Reconcile" step

| Snapshot state | Step state | Description | href |
|----------------|------------|-------------|------|
| Pre-publish | `not_started` | "Pending publish." | none |
| PUBLISHED + MATCHED | `completed` | "Auto-reconciled from source file." | none |
| PUBLISHED + MISMATCHED | `blocked` | "Mismatch detected — check reconciliation." | none |
| PUBLISHED + UNRECONCILED | `active` | "Source file total unavailable." | none |

The `/admin/reconciliation` link is removed from the step. Reconciliation result is visible inline on the same page.

## Out-of-Scope Notes

- `upsertReconciliation` and the POST `/api/snapshots/[snapshotId]/reconciliation` are left intact for future admin override capability.
- The `/admin/reconciliation` monitoring page continues to work; it will show UNRECONCILED for snapshots that have no stored entry (existing and new), which is accurate — it reflects "no manual override recorded."
- No ADR needed: this is a UI/service simplification that aligns the product with actual data flow, not a deviation from the locked schema.
