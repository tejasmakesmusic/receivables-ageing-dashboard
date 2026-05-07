import { describe, expect, it } from "vitest";
import { buildBucketSummaries } from "@/server/invoices/workbench";

describe("invoice workbench summaries", () => {
  it("aggregates invoice amounts by ageing bucket", () => {
    expect(
      buildBucketSummaries([
        { amount: "100.00", bucket: "NOT_DUE" },
        { amount: "50.00", bucket: "31_60" },
        { amount: "75.00", bucket: "31_60" },
        { amount: "25.00", bucket: "90_PLUS" },
      ]),
    ).toEqual([
      {
        amount: 100,
        bucket: "NOT_DUE",
        count: 1,
        label: "Current",
        percent: 40,
      },
      { amount: 0, bucket: "0_30", count: 0, label: "1-30 Days", percent: 0 },
      {
        amount: 125,
        bucket: "31_60",
        count: 2,
        label: "31-60 Days",
        percent: 50,
      },
      { amount: 0, bucket: "61_90", count: 0, label: "61-90 Days", percent: 0 },
      {
        amount: 25,
        bucket: "90_PLUS",
        count: 1,
        label: "91+ Days",
        percent: 10,
      },
    ]);
  });
});
