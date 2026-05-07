import { describe, expect, it } from "vitest";
import {
  COMMAND_GROUPS,
  filterCommandItems,
  flattenCommandItems,
} from "@/components/shell/command-menu-data";

describe("command menu data", () => {
  it("keeps every command href-only and grouped for safe navigation", () => {
    const items = flattenCommandItems(COMMAND_GROUPS);

    expect(items.length).toBeGreaterThan(8);
    expect(items.every((item) => item.href.startsWith("/"))).toBe(true);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("filters by label, keywords, and route", () => {
    const results = filterCommandItems("ageing export", COMMAND_GROUPS);

    expect(results.map((item) => item.id)).toContain("export-ageing");
    expect(results.every((item) => item.href.startsWith("/"))).toBe(true);
  });

  it("returns priority commands when the query is blank", () => {
    expect(filterCommandItems("", COMMAND_GROUPS).map((item) => item.id)).toEqual(
      [
        "today-focus",
        "accounts",
        "invoices",
        "collections",
        "upload-snapshot",
        "reports",
      ],
    );
  });
});
