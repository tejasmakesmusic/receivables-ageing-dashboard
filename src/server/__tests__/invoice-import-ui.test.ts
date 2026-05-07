import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const INVOICES_PAGE = join(process.cwd(), "src", "app", "invoices", "page.tsx");

describe("invoice import UI", () => {
  it("exposes a visible import action from the invoice workbench", () => {
    const source = readFileSync(INVOICES_PAGE, "utf8");

    expect(source).toContain('href="/upload"');
    expect(source).toContain("Import Invoices");
  });
});
