import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SNAPSHOTS_PAGE = join(ROOT, "src", "app", "snapshots", "page.tsx");
const SNAPSHOTS_LOADING = join(ROOT, "src", "app", "snapshots", "loading.tsx");

describe("Phase 2a - Snapshots DataTable + SidePanel", () => {
  it("Snapshots page uses DataTable with frozen identity columns and SidePanel", () => {
    const source = readFileSync(SNAPSHOTS_PAGE, "utf8");

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

  it("Snapshots page exposes the required upload columns and status lifecycle", () => {
    const source = readFileSync(SNAPSHOTS_PAGE, "utf8");

    expect(source).toContain("Snapshot");
    expect(source).toContain("Entity");
    expect(source).toContain("Source");
    expect(source).toContain("Status");
    expect(source).toContain("Uploaded By");
    expect(source).toContain("Uploaded");
    expect(source).toContain("Rows");
    expect(source).toContain("Warnings");
    expect(source).toContain("UPLOADED");
    expect(source).toContain("REJECTED");
    expect(source).toContain("FAILED");
    expect(source).toContain("<StatusTag");
  });

  it("Snapshots route ships a loading skeleton via DataTable state=loading", () => {
    expect(existsSync(SNAPSHOTS_LOADING)).toBe(true);

    const source = readFileSync(SNAPSHOTS_LOADING, "utf8");

    expect(source).toContain("state=\"loading\"");
    expect(source).toContain("DataTable");
  });
});
