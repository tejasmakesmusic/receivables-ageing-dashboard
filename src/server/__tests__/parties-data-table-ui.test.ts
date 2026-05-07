import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PARTIES_PAGE = join(ROOT, "src", "app", "parties", "page.tsx");
const PARTIES_LOADING = join(ROOT, "src", "app", "parties", "loading.tsx");

describe("Phase 2b - Parties DataTable + SidePanel", () => {
  it("Parties page uses DataTable with frozen identity columns and SidePanel", () => {
    const source = readFileSync(PARTIES_PAGE, "utf8");

    expect(source).toContain("from \"@/components/ui/data-table\"");
    expect(source).toContain("from \"@/components/ui/side-panel\"");
    expect(source).toContain("<DataTable");
    expect(source.match(/sticky:\s*"left"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("filteredEmptyState");
    expect(source).toContain("emptyState");
    expect(source).toContain("<SidePanel");
    expect(source).toContain("nextAction=");
    expect(source).toContain("openFullPageHref=");
  });

  it("Parties route ships a loading skeleton via DataTable state=loading", () => {
    expect(existsSync(PARTIES_LOADING)).toBe(true);

    const source = readFileSync(PARTIES_LOADING, "utf8");

    expect(source).toContain("state=\"loading\"");
    expect(source).toContain("DataTable");
  });
});
