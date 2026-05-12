import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...parts: string[]) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

describe("row action parity", () => {
  it("DataTable linked rows can be opened from the keyboard", () => {
    const row = source("src", "components", "ui", "data-table-row.tsx");

    expect(row).toContain("onKeyDown");
    expect(row).toContain('event.key === "Enter"');
    expect(row).toContain("pushHref(href)");
    expect(row).toContain('event.key === "Escape"');
    expect(row).toContain('event.key.toLowerCase() === "e"');
    expect(row).toContain('event.key.toLowerCase() === "c"');
    expect(row).toContain("tabIndex={interactive ? 0 : undefined}");
  });

  it("ships one shared icon row action component", () => {
    const action = source("src", "components", "ui", "row-actions.tsx");

    expect(action).toContain("ExternalLink");
    expect(action).toContain("group-hover:opacity-100");
    expect(action).toContain("focus:opacity-100");
  });

  it("uses shared row actions on core object tables", () => {
    const combined = [
      source("src", "app", "invoices", "page.tsx"),
      source("src", "app", "tasks", "page.tsx"),
      source("src", "app", "parties", "page.tsx"),
      source("src", "app", "dispute-cases", "page.tsx"),
    ].join("\n");

    expect(combined.match(/RowActionLink/g)?.length).toBeGreaterThanOrEqual(4);
    expect(combined.match(/key:\s*"action"|key:\s*"action"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(combined.match(/rowCreateHref/g)?.length).toBeGreaterThanOrEqual(4);
    expect(combined.match(/rowEditHref/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
