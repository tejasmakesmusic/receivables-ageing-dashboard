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
    expect(source).toContain("snapshot.total_outstanding");
    expect(source).toContain("parseToCents(computed.dashboardAr) - parseToCents(autoClosingAr)");
  });

  it("returns UNRECONCILED when total_outstanding is null", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source).toContain("autoClosingAr");
    expect(source).toContain('"UNRECONCILED"');
  });

  it("manual entry still wins over auto-reconcile when present", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source).toContain("entry.tally_xero_closing_ar");
    expect(source).toContain("effectiveClosingAr");
    expect(source).toContain("effectiveStatus");
  });
});
