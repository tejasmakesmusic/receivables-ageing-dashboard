import { describe, expect, it } from "vitest";
import {
  SYSTEM_VIEW_IDS,
  buildSystemViewHref,
  getCollectionTaskSystemViewFilter,
  getInvoiceSystemViewParams,
  getSystemViewsForSurface,
  parseSystemViewId,
} from "@/server/views/system-views";

describe("system views", () => {
  it("defines the approved launch system views only", () => {
    expect(SYSTEM_VIEW_IDS).toEqual([
      "90_PLUS_HIGH_VALUE",
      "BROKEN_PTP",
      "UNMAPPED_PARTIES",
      "RECONCILIATION_MISMATCHES",
      "DUE_TODAY",
    ]);
  });

  it("maps invoice launch views to existing invoice filters", () => {
    expect(getInvoiceSystemViewParams("90_PLUS_HIGH_VALUE")).toEqual({
      overdue_bucket: "90_PLUS",
      status: "OPEN",
    });
    expect(getInvoiceSystemViewParams("BROKEN_PTP")).toBeNull();
  });

  it("maps task views to server-side collection task filters", () => {
    const today = new Date("2026-05-06T00:00:00.000Z");

    expect(
      getCollectionTaskSystemViewFilter("90_PLUS_HIGH_VALUE", today),
    ).toEqual({
      reasonCodes: ["NINETY_PLUS", "HIGH_VALUE"],
      statuses: ["SUGGESTED", "OPEN", "IN_PROGRESS"],
    });

    expect(getCollectionTaskSystemViewFilter("BROKEN_PTP", today)).toEqual({
      reasonCodes: ["BROKEN_PROMISE"],
      statuses: ["SUGGESTED", "OPEN", "IN_PROGRESS"],
    });

    expect(getCollectionTaskSystemViewFilter("DUE_TODAY", today)).toEqual({
      dueDateOnOrBefore: new Date("2026-05-06T00:00:00.000Z"),
      statuses: ["SUGGESTED", "OPEN", "IN_PROGRESS", "SNOOZED"],
    });
  });

  it("builds deterministic hrefs for the current launch surfaces", () => {
    expect(buildSystemViewHref("90_PLUS_HIGH_VALUE", "invoices")).toBe(
      "/invoices?system_view=90_PLUS_HIGH_VALUE&status=OPEN&overdue_bucket=90_PLUS",
    );
    expect(buildSystemViewHref("BROKEN_PTP", "tasks")).toBe(
      "/tasks?system_view=BROKEN_PTP",
    );
    expect(
      buildSystemViewHref("RECONCILIATION_MISMATCHES", "invoices"),
    ).toBe("/admin/reconciliation?system_view=RECONCILIATION_MISMATCHES");
  });

  it("returns compact tabs for relevant pages without custom persisted views", () => {
    expect(getSystemViewsForSurface("tasks").map((view) => view.id)).toEqual([
      "90_PLUS_HIGH_VALUE",
      "BROKEN_PTP",
      "DUE_TODAY",
    ]);
    expect(getSystemViewsForSurface("invoices").map((view) => view.id)).toEqual([
      "90_PLUS_HIGH_VALUE",
      "UNMAPPED_PARTIES",
      "RECONCILIATION_MISMATCHES",
    ]);
  });

  it("parses only known system view ids", () => {
    expect(parseSystemViewId("DUE_TODAY")).toBe("DUE_TODAY");
    expect(parseSystemViewId("private_custom_view")).toBeNull();
    expect(parseSystemViewId(undefined)).toBeNull();
  });
});
