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

  it("uses canonical Parties and Tasks navigation vocabulary", () => {
    const items = flattenCommandItems(COMMAND_GROUPS);

    expect(items.find((item) => item.id === "accounts")).toMatchObject({
      href: "/parties",
      label: "Parties",
    });
    expect(items.find((item) => item.id === "collections")).toMatchObject({
      href: "/tasks",
      label: "Tasks",
    });
    expect(
      items
        .filter((item) => item.id.startsWith("view-"))
        .map((item) => item.href),
    ).toEqual([
      "/tasks?system_view=90_PLUS_HIGH_VALUE",
      "/tasks?system_view=BROKEN_PTP",
      "/tasks?system_view=DUE_TODAY",
    ]);
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
