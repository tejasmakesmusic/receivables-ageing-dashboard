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

  it("does NOT ship a colocated loading.tsx (Next 16 + Turbopack streaming bug)", () => {
    // Intentionally deleted. The Suspense boundary triggered by a
    // colocated loading.tsx never gets swapped in by Next.js 16
    // streaming under Turbopack dev — users saw the skeleton forever
    // while the real content sat at width=0, height=0 outside <main>.
    // Re-adding this file will reintroduce the bug.
    expect(existsSync(SNAPSHOTS_LOADING)).toBe(false);
  });
});
