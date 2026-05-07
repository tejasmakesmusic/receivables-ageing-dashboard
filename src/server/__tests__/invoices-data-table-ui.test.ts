import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DATA_TABLE = join(ROOT, "src", "components", "ui", "data-table.tsx");
const SIDE_PANEL = join(ROOT, "src", "components", "ui", "side-panel.tsx");
const INVOICES_PAGE = join(ROOT, "src", "app", "invoices", "page.tsx");
const INVOICES_LOADING = join(ROOT, "src", "app", "invoices", "loading.tsx");

describe("Phase 2a — Invoices DataTable + SidePanel", () => {
  it("ships a reusable DataTable with sticky columns and state machine", () => {
    expect(existsSync(DATA_TABLE)).toBe(true);

    const source = readFileSync(DATA_TABLE, "utf8");

    expect(source).toContain("export function DataTable");
    expect(source).toContain("export type DataTableColumn");
    expect(source).toContain("sticky?: \"left\"");
    expect(source).toContain('state === "loading"');
    expect(source).toContain('state === "error"');
    expect(source).toContain("filteredEmptyState");
    expect(source).toContain("emptyState");
    expect(source).toContain("animate-pulse");
  });

  it("ships a reusable SidePanel with audit meta and next-action footer", () => {
    expect(existsSync(SIDE_PANEL)).toBe(true);

    const source = readFileSync(SIDE_PANEL, "utf8");

    expect(source).toContain("export function SidePanel");
    expect(source).toContain("openFullPageHref");
    expect(source).toContain("nextAction");
    expect(source).toContain("export function SidePanelField");
  });

  it("Invoices page uses DataTable with frozen identity columns and SidePanel", () => {
    const source = readFileSync(INVOICES_PAGE, "utf8");

    expect(source).toContain("from \"@/components/ui/data-table\"");
    expect(source).toContain("from \"@/components/ui/side-panel\"");
    expect(source).toContain("<DataTable<InvoiceListRow>");
    // Two sticky identity columns for invoice ref + account
    expect(source.match(/sticky:\s*"left"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("filteredEmptyState");
    expect(source).toContain("emptyState");
    expect(source).toContain("<SidePanel");
    expect(source).toContain("nextAction=");
    expect(source).toContain("openFullPageHref=");
  });

  it("Invoices route ships a loading skeleton via DataTable state=loading", () => {
    expect(existsSync(INVOICES_LOADING)).toBe(true);

    const source = readFileSync(INVOICES_LOADING, "utf8");

    expect(source).toContain("state=\"loading\"");
    expect(source).toContain("DataTable");
  });
});
