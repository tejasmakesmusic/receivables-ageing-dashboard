import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TASKS_PAGE = join(ROOT, "src", "app", "tasks", "page.tsx");
const TASKS_LOADING = join(ROOT, "src", "app", "tasks", "loading.tsx");

describe("Phase 2a - Tasks DataTable + SidePanel", () => {
  it("Tasks page uses DataTable with frozen identity columns and SidePanel", () => {
    const source = readFileSync(TASKS_PAGE, "utf8");

    expect(source).toContain("from \"@/components/ui/data-table\"");
    expect(source).toContain("from \"@/components/ui/side-panel\"");
    expect(source.match(/sticky:\s*"left"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("filteredEmptyState");
    expect(source).toContain("emptyState");
    expect(source).toContain("<SidePanel");
    expect(source).toContain("nextAction=");
  });

  it("does NOT ship a colocated loading.tsx (Next 16 + Turbopack streaming bug)", () => {
    // Intentionally deleted — see snapshots-data-table-ui.test.ts for
    // the full bug story. Re-adding will reintroduce the issue.
    expect(existsSync(TASKS_LOADING)).toBe(false);
  });
});
