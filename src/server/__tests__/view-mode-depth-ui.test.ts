import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...parts: string[]) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

describe("Sprint 3 view mode depth", () => {
  it("adds table and compact view modes to invoices", () => {
    const invoices = source("src", "app", "invoices", "page.tsx");

    expect(invoices).toContain('type InvoiceViewMode = "table" | "compact"');
    expect(invoices).toContain("invoiceViewHref");
    expect(invoices).toContain('params.view === "compact"');
    expect(invoices).toContain("<LayoutList");
    expect(invoices).toContain("<Rows3");
  });

  it("keeps Tasks view modes available as board, calendar, and queue", () => {
    const tasks = source("src", "app", "tasks", "page.tsx");

    expect(tasks).toContain('type CollectionsTab = "board" | "calendar" | "queue"');
    expect(tasks).toContain("VIEW_TABS");
    expect(tasks).toContain('activeTab === "board"');
    expect(tasks).toContain('activeTab === "calendar"');
    expect(tasks).toContain('activeTab === "queue"');
  });

  it("adds table and queue view modes to reconciliation", () => {
    const reconciliation = source("src", "app", "reconciliation", "page.tsx");

    expect(reconciliation).toContain('type ReconciliationViewMode = "table" | "queue"');
    expect(reconciliation).toContain("reconciliationViewHref");
    expect(reconciliation).toContain('activeView === "queue"');
    expect(reconciliation).toContain("<Table2");
  });
});
