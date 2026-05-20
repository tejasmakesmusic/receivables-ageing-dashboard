# Auto-Reconcile Snapshot Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead manual reconciliation entry flow with on-the-fly auto-reconcile that compares `dashboard_ar` (sum of published invoice rows) against `snapshot.total_outstanding` (grand total from the uploaded source file).

**Architecture:** Modify `getOrComputeReconciliation` in the service layer to fall back to `snapshot.total_outstanding` as the reference AR when no manual `reconciliation_entries` row exists. Update the snapshot detail page to show a read-only "Data Integrity" card with a MATCHED/MISMATCHED banner and update the ProgressPath "Reconcile" step to reflect the auto-computed state. Delete the unused `ReconciliationForm` client component.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7, Tailwind CSS 4, Vitest, lucide-react

---

### Task 1: Service — auto-reconcile fallback in `getOrComputeReconciliation`

**Files:**
- Modify: `src/server/snapshots/service.ts` (function `getOrComputeReconciliation`, lines ~2893–2933)
- Test: `src/server/__tests__/auto-reconcile-service.test.ts` ← new file

---

- [ ] **Step 1: Write the failing test**

Create `src/server/__tests__/auto-reconcile-service.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = join(
  process.cwd(),
  "src",
  "server",
  "snapshots",
  "service.ts",
);

describe("auto-reconcile fallback in getOrComputeReconciliation", () => {
  it("uses snapshot.total_outstanding as the reference AR when no manual entry exists", () => {
    const source = readFileSync(SERVICE, "utf8");
    // The fallback must read the snapshot's stored total
    expect(source).toContain("snapshot.total_outstanding");
    // The auto-delta uses dashboardAr minus autoClosingAr (no exceptionBucketTotal)
    expect(source).toContain("parseToCents(computed.dashboardAr) - parseToCents(autoClosingAr)");
  });

  it("returns UNRECONCILED when total_outstanding is null", () => {
    const source = readFileSync(SERVICE, "utf8");
    // Guard: only auto-compute when total_outstanding is present
    expect(source).toContain("autoClosingAr");
    expect(source).toContain('"UNRECONCILED"');
  });

  it("manual entry still wins over auto-reconcile when present", () => {
    const source = readFileSync(SERVICE, "utf8");
    // entry takes precedence over autoClosingAr — both identifiers must appear together
    expect(source).toContain("entry.tally_xero_closing_ar");
    expect(source).toContain("effectiveClosingAr");
    expect(source).toContain("effectiveStatus");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/__tests__/auto-reconcile-service.test.ts
```

Expected: FAIL — the service doesn't contain `autoClosingAr` yet.

- [ ] **Step 3: Implement the service change**

In `src/server/snapshots/service.ts`, locate the return block of `getOrComputeReconciliation` (after `const [entry, computed] = await Promise.all([...])`).

Replace the current return statement (lines ~2914–2932):

```typescript
  return {
    snapshot_id: snapshotId,
    snapshot_as_of_date: toDate(snapshot.as_of_date),
    entity_code: snapshot.entities.code as "IND" | "UAE",
    dashboard_ar: computed.dashboardAr,
    exception_bucket_total: computed.exceptionBucketTotal,
    exception_bucket_breakdown: computed.exceptionBucketBreakdown,
    tally_xero_closing_ar: entry
      ? formatDecimal(entry.tally_xero_closing_ar)
      : null,
    delta: entry ? formatDecimal(entry.delta) : null,
    status: (entry?.status ??
      "UNRECONCILED") as ReconciliationResponse["status"],
    entered_by: entry?.users
      ? { id: entry.users.id, email: entry.users.email }
      : null,
    entered_at: entry?.entered_at ? entry.entered_at.toISOString() : null,
    notes: entry?.notes ?? null,
  };
```

With:

```typescript
  // Auto-reconcile fallback: when no manual entry exists, use the snapshot's
  // stored grand total (from the uploaded source file) as the reference AR.
  // Delta formula: dashboardAr − total_outstanding (parse-completeness check).
  // This differs from upsertReconciliation which used dashboardAr + exceptionBucketTotal
  // because dashboardAr in the code already includes all invoices.
  const autoClosingAr = snapshot.total_outstanding
    ? formatDecimal(snapshot.total_outstanding)
    : null;

  const effectiveClosingAr = entry
    ? formatDecimal(entry.tally_xero_closing_ar)
    : autoClosingAr;

  const effectiveDelta = entry
    ? formatDecimal(entry.delta)
    : autoClosingAr
      ? formatFromCents(
          parseToCents(computed.dashboardAr) - parseToCents(autoClosingAr),
        )
      : null;

  const effectiveStatus: ReconciliationResponse["status"] = entry
    ? (entry.status as ReconciliationResponse["status"])
    : autoClosingAr
      ? reconciliationStatus(
          parseToCents(computed.dashboardAr) - parseToCents(autoClosingAr),
        )
      : "UNRECONCILED";

  return {
    snapshot_id: snapshotId,
    snapshot_as_of_date: toDate(snapshot.as_of_date),
    entity_code: snapshot.entities.code as "IND" | "UAE",
    dashboard_ar: computed.dashboardAr,
    exception_bucket_total: computed.exceptionBucketTotal,
    exception_bucket_breakdown: computed.exceptionBucketBreakdown,
    tally_xero_closing_ar: effectiveClosingAr,
    delta: effectiveDelta,
    status: effectiveStatus,
    entered_by: entry?.users
      ? { id: entry.users.id, email: entry.users.email }
      : null,
    entered_at: entry?.entered_at ? entry.entered_at.toISOString() : null,
    notes: entry?.notes ?? null,
  };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/__tests__/auto-reconcile-service.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/__tests__/auto-reconcile-service.test.ts src/server/snapshots/service.ts
git commit -m "feat(reconcile): auto-reconcile from snapshot.total_outstanding when no manual entry"
```

---

### Task 2: Snapshot detail page — Data Integrity card

**Files:**
- Modify: `src/app/snapshots/[snapshotId]/page.tsx`
- Test: `src/server/__tests__/auto-reconcile-page-ui.test.ts` ← new file

---

- [ ] **Step 1: Write the failing test**

Create `src/server/__tests__/auto-reconcile-page-ui.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(
  process.cwd(),
  "src",
  "app",
  "snapshots",
  "[snapshotId]",
  "page.tsx",
);

describe("snapshot detail page — auto-reconcile UI", () => {
  it("shows a Data Integrity card title instead of Reconciliation", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("Data Integrity");
    expect(source).not.toContain(">Reconciliation<");
  });

  it("renders the Source File Total label for the auto-computed reference", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("Source File Total");
  });

  it("renders MATCHED banner with CheckCircle2 icon", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("CheckCircle2");
    expect(source).toContain("Auto-reconciled");
  });

  it("renders MISMATCHED banner with AlertTriangle icon", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("AlertTriangle");
    expect(source).toContain("Mismatch:");
  });

  it("only renders the Data Integrity card for PUBLISHED snapshots", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain('snapshot.status === "PUBLISHED"');
  });

  it("does not import or reference ReconciliationForm", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).not.toContain("ReconciliationForm");
    expect(source).not.toContain("reconciliation-form");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/__tests__/auto-reconcile-page-ui.test.ts
```

Expected: FAIL — page doesn't yet contain "Data Integrity", "Source File Total", etc.

- [ ] **Step 3: Add lucide-react imports to page.tsx**

In `src/app/snapshots/[snapshotId]/page.tsx`, add the import after the existing imports (before `import Link from "next/link"` or at a natural position):

```typescript
import { AlertTriangle, CheckCircle2 } from "lucide-react";
```

- [ ] **Step 4: Replace the Reconciliation card with the Data Integrity card**

In `src/app/snapshots/[snapshotId]/page.tsx`, locate and replace the entire `<Card>` block that renders the Reconciliation section (lines ~327–383):

```tsx
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation</CardTitle>
          </CardHeader>
          <CardContent>
            {reconciliation ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                <dt className="text-[var(--color-text-muted)]">Dashboard AR</dt>
                  <dd>
                    {formatCurrency(reconciliation.dashboard_ar, currency)}
                  </dd>
                </div>
                <div>
                <dt className="text-[var(--color-text-muted)]">Exception Buckets</dt>
                  <dd>
                    {formatCurrency(
                      reconciliation.exception_bucket_total,
                      currency,
                    )}
                  </dd>
                </div>
                <div>
                <dt className="text-[var(--color-text-muted)]">Status</dt>
                  <dd>{reconciliation.status}</dd>
                </div>
                <div>
                <dt className="text-[var(--color-text-muted)]">Closing AR</dt>
                  <dd>
                    {reconciliation.tally_xero_closing_ar
                      ? formatCurrency(
                          reconciliation.tally_xero_closing_ar,
                          currency,
                        )
                      : "-"}
                  </dd>
                </div>
                <div>
                <dt className="text-[var(--color-text-muted)]">Delta</dt>
                  <dd>
                    {reconciliation.delta
                      ? formatCurrency(reconciliation.delta, currency)
                      : "-"}
                  </dd>
                </div>
                <div>
                <dt className="text-[var(--color-text-muted)]">Entered By</dt>
                  <dd>{reconciliation.entered_by?.email ?? "-"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                {reconciliationMessage}
              </p>
            )}
          </CardContent>
        </Card>
```

Replace with:

```tsx
        {snapshot.status === "PUBLISHED" ? (
          <Card>
            <CardHeader>
              <CardTitle>Data Integrity</CardTitle>
            </CardHeader>
            <CardContent>
              {reconciliation ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Dashboard AR</dt>
                      <dd className="font-medium">
                        {formatCurrency(reconciliation.dashboard_ar, currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Source File Total</dt>
                      <dd className="font-medium">
                        {reconciliation.tally_xero_closing_ar
                          ? formatCurrency(reconciliation.tally_xero_closing_ar, currency)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Delta</dt>
                      <dd className="font-medium">
                        {reconciliation.delta
                          ? formatCurrency(reconciliation.delta, currency)
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  {reconciliation.status === "MATCHED" ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] px-3 py-2 text-xs text-[var(--color-status-current-text)]">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Auto-reconciled — dashboard matches source file.
                    </div>
                  ) : reconciliation.status === "MISMATCHED" ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 py-2 text-xs text-[var(--color-status-danger-text)]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {`Mismatch: ${reconciliation.delta ? formatCurrency(reconciliation.delta, currency) : "unknown"} gap between dashboard and source file.`}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Source file total unavailable — reconciliation skipped.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">
                  {reconciliationMessage ?? "Reconciliation unavailable."}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/server/__tests__/auto-reconcile-page-ui.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/__tests__/auto-reconcile-page-ui.test.ts src/app/snapshots/\[snapshotId\]/page.tsx
git commit -m "feat(snapshot-detail): replace Reconciliation card with auto-reconcile Data Integrity card"
```

---

### Task 3: ProgressPath reconcile step — auto-state logic

**Files:**
- Modify: `src/app/snapshots/[snapshotId]/page.tsx` — `buildProgressSteps` function

The test file from Task 2 already covers the page. No new test file needed.

---

- [ ] **Step 1: Write the failing test assertion**

Add to `src/server/__tests__/auto-reconcile-page-ui.test.ts` inside the existing `describe` block:

```typescript
  it("ProgressPath reconcile step uses auto-reconcile state labels", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("Auto-reconciled from source file.");
    expect(source).toContain("Mismatch detected — check reconciliation.");
    expect(source).toContain("Pending publish.");
    // The link to /admin/reconciliation is removed
    expect(source).not.toContain('"/admin/reconciliation"');
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/server/__tests__/auto-reconcile-page-ui.test.ts
```

Expected: FAIL on the new assertion.

- [ ] **Step 3: Update `buildProgressSteps` in page.tsx**

Locate the `reconcile` step inside `buildProgressSteps` (lines ~159–172):

```typescript
    {
      id: "reconcile",
      label: "Reconcile",
      description: hasReconciliation
        ? "Reconciliation entry is recorded."
        : "Reconciliation entry is pending.",
      state: hasReconciliation
        ? "completed"
        : isPublished
          ? "active"
          : "not_started",
      href: isPublished ? "/admin/reconciliation" : undefined,
    },
```

Replace with:

```typescript
    {
      id: "reconcile",
      label: "Reconcile",
      description:
        reconciliation?.status === "MATCHED"
          ? "Auto-reconciled from source file."
          : reconciliation?.status === "MISMATCHED"
            ? "Mismatch detected — check reconciliation."
            : isPublished
              ? "Source file total unavailable."
              : "Pending publish.",
      state:
        reconciliation?.status === "MATCHED"
          ? "completed"
          : reconciliation?.status === "MISMATCHED"
            ? "blocked"
            : isPublished
              ? "active"
              : "not_started",
      href: undefined,
    },
```

Also remove the now-unused `hasReconciliation` variable at the top of `buildProgressSteps`:

```typescript
// Remove this line:
  const hasReconciliation =
    reconciliation !== null && reconciliation.status !== "UNRECONCILED";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/__tests__/auto-reconcile-page-ui.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/__tests__/auto-reconcile-page-ui.test.ts src/app/snapshots/\[snapshotId\]/page.tsx
git commit -m "feat(snapshot-detail): auto-reconcile ProgressPath step — no manual entry link"
```

---

### Task 4: Delete the unused `ReconciliationForm` component

**Files:**
- Delete: `src/app/snapshots/[snapshotId]/_components/reconciliation-form.tsx`
- Test: verify via source analysis that it is gone

---

- [ ] **Step 1: Delete the file**

```bash
rm src/app/snapshots/\[snapshotId\]/_components/reconciliation-form.tsx
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -r "reconciliation-form\|ReconciliationForm" src/ --include="*.tsx" --include="*.ts"
```

Expected: no output (zero matches).

- [ ] **Step 3: Commit**

```bash
git add -A src/app/snapshots/\[snapshotId\]/_components/reconciliation-form.tsx
git commit -m "chore: delete unused ReconciliationForm component"
```

---

### Task 5: Verification

**Files:** none changed — this is a verify-only task.

---

- [ ] **Step 1: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: no errors or warnings added by this change.

- [ ] **Step 3: Full test suite**

```bash
npx vitest run
```

Expected: all tests pass. Confirm `auto-reconcile-service.test.ts` and `auto-reconcile-page-ui.test.ts` are in the output.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: successful build, no type errors.

- [ ] **Step 5: Commit verification artifacts (if any build output changed)**

If only source files changed (no new dist artefacts):

```bash
git status
```

Nothing to commit — all work was committed in Tasks 1–4.
