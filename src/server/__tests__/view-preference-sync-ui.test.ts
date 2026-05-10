import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function source(...parts: string[]) {
  return readFileSync(join(ROOT, ...parts), "utf8");
}

describe("view preference sync", () => {
  it("stores explicit view params and restores saved view modes", () => {
    const sync = source(
      "src",
      "components",
      "interaction",
      "view-preference-sync.tsx",
    );

    expect(sync).toContain('"use client"');
    expect(sync).toContain("window.localStorage.setItem(storageKey, currentView)");
    expect(sync).toContain("window.localStorage.getItem(storageKey)");
    expect(sync).toContain("router.replace");
  });

  it("wires view persistence into major view-mode surfaces", () => {
    const combined = [
      source("src", "app", "invoices", "page.tsx"),
      source("src", "app", "tasks", "page.tsx"),
      source("src", "app", "reconciliation", "page.tsx"),
    ].join("\n");

    expect(combined.match(/<ViewPreferenceSync/g)?.length).toBe(3);
    expect(combined).toContain("receivables.invoices.view-mode.v1");
    expect(combined).toContain("receivables.tasks.view-mode.v1");
    expect(combined).toContain("receivables.reconciliation.view-mode.v1");
  });
});
