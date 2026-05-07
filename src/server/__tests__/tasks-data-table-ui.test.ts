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

  it("Tasks route ships a loading skeleton via DataTable state=loading", () => {
    expect(existsSync(TASKS_LOADING)).toBe(true);

    const source = readFileSync(TASKS_LOADING, "utf8");

    expect(source).toContain("state=\"loading\"");
    expect(source).toContain("DataTable");
  });
});
