import { describe, expect, it } from "vitest";

import {
  addDaysUtc,
  ageingBucket,
  calculateAgeing,
  daysBetweenUtc,
} from "@/server/ageing/buckets";

describe("ageing bucket boundaries", () => {
  it("treats invoices due on the snapshot date as DUE_TODAY", () => {
    expect(ageingBucket(0)).toBe("DUE_TODAY");
  });

  it.each([
    [-2, "NOT_DUE"],
    [-1, "NOT_DUE"],
    [0, "DUE_TODAY"],
    [1, "0_30"],
    [30, "0_30"],
    [31, "31_60"],
    [60, "31_60"],
    [61, "61_90"],
    [90, "61_90"],
    [91, "90_PLUS"],
  ])("maps %i overdue days to %s", (overdueDays, bucket) => {
    expect(ageingBucket(overdueDays)).toBe(bucket);
  });

  it("calculates leap-year due dates in UTC without drifting", () => {
    expect(addDaysUtc("2024-02-28", 1).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z",
    );
    expect(addDaysUtc("2024-02-28", 2).toISOString()).toBe(
      "2024-03-01T00:00:00.000Z",
    );
  });

  it("calculates days past due from the snapshot as_of_date", () => {
    expect(
      daysBetweenUtc(
        new Date("2026-05-06T00:00:00.000Z"),
        new Date("2026-05-07T23:59:59.000Z"),
      ),
    ).toBe(1);
  });

  it("returns a complete ageing result from invoice date, credit days, and as_of_date", () => {
    expect(
      calculateAgeing({
        invoiceDate: "2026-04-06",
        creditDays: 30,
        asOfDate: "2026-05-06",
      }),
    ).toEqual({
      dueDate: new Date("2026-05-06T00:00:00.000Z"),
      overdueDays: 0,
      bucket: "DUE_TODAY",
    });
  });
});
