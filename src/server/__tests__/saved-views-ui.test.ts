import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("saved views invoice UI", () => {
  it("loads invoice saved views from the API in the switcher", () => {
    const filePath = join(
      ROOT,
      "components",
      "saved-views",
      "saved-view-switcher.tsx",
    );

    expect(existsSync(filePath)).toBe(true);
    expect(source("components/saved-views/saved-view-switcher.tsx")).toContain(
      "/api/views?surface=invoices",
    );
  });

  it("posts new invoice saved views from the composer", () => {
    const filePath = join(
      ROOT,
      "components",
      "saved-views",
      "saved-view-composer.tsx",
    );

    expect(existsSync(filePath)).toBe(true);
    expect(source("components/saved-views/saved-view-composer.tsx")).toContain(
      "fetch(\"/api/views\"",
    );
    expect(source("components/saved-views/saved-view-composer.tsx")).toContain(
      "method: \"POST\"",
    );
  });

  it("mounts the invoice saved view switcher with role context", () => {
    const page = source("app/invoices/page.tsx");

    expect(page).toContain(
      'import { SavedViewSwitcher } from "@/components/saved-views/saved-view-switcher"',
    );
    expect(page).toContain("surface=\"invoices\"");
    expect(page).toContain("currentUserRole={currentUser.role}");
  });

  it("disables public saved views for non-admin users", () => {
    const composer = source("components/saved-views/saved-view-composer.tsx");

    expect(composer).toContain('currentUserRole !== "ADMIN"');
    expect(composer).toContain("disabled={publicDisabled}");
  });
});
