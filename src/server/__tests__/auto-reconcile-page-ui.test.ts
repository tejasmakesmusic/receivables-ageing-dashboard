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

  it("ProgressPath reconcile step uses auto-reconcile state labels", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("Auto-reconciled from source file.");
    expect(source).toContain("Mismatch detected — check reconciliation.");
    expect(source).toContain("Pending publish.");
    // The link to /admin/reconciliation is removed
    expect(source).not.toContain('"/admin/reconciliation"');
  });
});
