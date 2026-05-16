import { describe, expect, it } from "vitest";
import { getStatusTag, STATUS_TAGS } from "@/components/ui/status-tag-map";

const REQUIRED_FINANCE_STATES = [
  "NOT_DUE",
  "0_30",
  "31_60",
  "61_90",
  "90_PLUS",
  "SETTLED",
  "PTP_OPEN",
  "PTP_BROKEN",
  "DISPUTE_OPEN",
  "MATCHED",
  "MISMATCH",
  "OVERRIDE",
  "READ_ONLY",
  "NO_DATA",
  "FOLLOW_UP_DUE",
  "STAGING_BLOCKED",
  "TASK_SNOOZED",
  "TASK_DONE",
  "RECONCILIATION_PENDING",
  "WORKFLOW_DRAFT",
  "WORKFLOW_DISABLED",
] as const;

describe("status tag map", () => {
  it("defines labelled, semantic classes for the launch finance states", () => {
    for (const state of REQUIRED_FINANCE_STATES) {
      const tag = STATUS_TAGS[state];

      expect(tag, state).toBeDefined();
      expect(tag.label.trim(), state).not.toHaveLength(0);
      expect(tag.className, state).toContain("--color-status-");
      expect(tag.className, state).toContain("bg-[var(");
      expect(tag.className, state).toContain("text-[var(");
      // Status tags use `border-transparent` (relying on bg color for shape)
      // — borders are kept only on banner-style alerts, not chip-style badges.
      expect(tag.className, state).toMatch(/border-(?:transparent|\[var\()/);
    }
  });

  it("returns stable business labels for audited status strings", () => {
    expect(getStatusTag("NOT_DUE").label).toBe("Not Due");
    expect(getStatusTag("90_PLUS").label).toBe("90+");
    expect(getStatusTag("PTP_OPEN").label).toBe("PTP Open");
    expect(getStatusTag("PTP_BROKEN").label).toBe("PTP Broken");
    expect(getStatusTag("DISPUTE_OPEN").label).toBe("Dispute Open");
    expect(getStatusTag("OVERRIDE").label).toBe("Admin Override");
  });

  it("falls back to a neutral tag for unknown statuses without hiding the value", () => {
    const tag = getStatusTag("CUSTOM_REVIEW_STATE");

    expect(tag.label).toBe("Custom Review State");
    expect(tag.className).toContain("--color-status-neutral-");
  });
});
