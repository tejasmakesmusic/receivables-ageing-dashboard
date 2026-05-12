import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DISPUTES_PAGE = join(ROOT, "src", "app", "dispute-cases", "page.tsx");
const DISPUTES_LOADING = join(
  ROOT,
  "src",
  "app",
  "dispute-cases",
  "loading.tsx",
);

describe("Phase 2a - Dispute Cases DataTable + SidePanel", () => {
  it("Dispute Cases page uses DataTable with frozen identity columns and SidePanel", () => {
    const source = readFileSync(DISPUTES_PAGE, "utf8");

    expect(source).toContain("from \"@/components/ui/data-table\"");
    expect(source).toContain("from \"@/components/ui/side-panel\"");
    expect(source).toContain("<DataTable<");
    expect(source.match(/sticky:\s*"left"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("filteredEmptyState");
    expect(source).toContain("emptyState");
    expect(source).toContain("<SidePanel");
    expect(source).toContain("nextAction=");
    expect(source).toContain("openFullPageHref=");
  });

  it("Dispute Cases page exposes the required operating columns and lifecycle labels", () => {
    const source = readFileSync(DISPUTES_PAGE, "utf8");

    expect(source).toContain("Invoice");
    expect(source).toContain("Party");
    expect(source).toContain("Reason Code");
    expect(source).toContain("Expected Resolution");
    expect(source).toContain("Owner");
    expect(source).toContain("Created");
    expect(source).toContain("Investigating");
    expect(source).toContain("Escalated");
    expect(source).toContain("Cancelled");
    expect(source).toContain("<StatusTag");
  });

  it("does NOT ship a colocated loading.tsx (Next 16 + Turbopack streaming bug)", () => {
    // Intentionally deleted — see snapshots-data-table-ui.test.ts for
    // the full bug story. Re-adding will reintroduce the issue.
    expect(existsSync(DISPUTES_LOADING)).toBe(false);
  });
});
