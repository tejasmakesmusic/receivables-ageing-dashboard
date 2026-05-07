import { describe, expect, it } from "vitest";
import { summarizeAccount } from "@/server/accounts/service";

describe("account aggregation helpers", () => {
  it("summarizes open invoice exposure and worst bucket", () => {
    const summary = summarizeAccount({
      invoices: [
        {
          active_exception_count: 0,
          bucket: "0_30",
          outstanding_amount: "100.00",
        },
        {
          active_exception_count: 2,
          bucket: "90_PLUS",
          outstanding_amount: "250.00",
        },
      ],
    });

    expect(summary.total_outstanding).toBe("350.00");
    expect(summary.overdue_amount).toBe("350.00");
    expect(summary.worst_bucket).toBe("90_PLUS");
    expect(summary.active_exception_count).toBe(2);
    expect(summary.collection_health).toBe("At Risk");
  });

  it("keeps accounts with no invoices in a neutral state", () => {
    expect(summarizeAccount({ invoices: [] })).toEqual({
      active_exception_count: 0,
      collection_health: "Good",
      overdue_amount: "0.00",
      total_outstanding: "0.00",
      worst_bucket: "NOT_DUE",
    });
  });
});
