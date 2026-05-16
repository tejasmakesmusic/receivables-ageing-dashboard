import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  AED_PER_USD,
  fetchRatesForPair,
} from "@/server/fx/backfill";
import type { FrankfurterFetcher } from "@/server/fx/frankfurter";

function fakeFetcher(
  rates: Record<string, Record<string, number>>,
): FrankfurterFetcher {
  return async ({ base, target, startDate, endDate }) => ({
    amount: 1,
    base,
    start_date: startDate,
    end_date: endDate,
    // Only return rows where the target currency is present
    rates: Object.fromEntries(
      Object.entries(rates).filter(([, r]) => target in r),
    ),
  });
}

describe("fx backfill — fetchRatesForPair", () => {
  const startDate = new Date("2024-01-01T00:00:00Z");
  const endDate = new Date("2024-01-31T00:00:00Z");

  it("returns empty when source equals target", async () => {
    const result = await fetchRatesForPair({
      source: "INR",
      target: "INR",
      startDate,
      endDate,
      fetcher: fakeFetcher({}),
    });
    expect(result).toEqual({});
  });

  it("passes through direct Frankfurter rates for non-AED pairs", async () => {
    const fetcher = fakeFetcher({
      "2024-01-02": { INR: 83.05 },
      "2024-01-03": { INR: 83.1 },
    });
    const result = await fetchRatesForPair({
      source: "USD",
      target: "INR",
      startDate,
      endDate,
      fetcher,
    });
    expect(Object.keys(result).sort()).toEqual(["2024-01-02", "2024-01-03"]);
    expect(result["2024-01-02"].toString()).toBe("83.05");
    expect(result["2024-01-03"].toString()).toBe("83.1");
  });

  it("derives AED→INR via USD peg (AED→target = USD→target / 3.6725)", async () => {
    const fetcher = fakeFetcher({
      "2024-01-02": { INR: 83.05 }, // USD→INR on this date
    });
    const result = await fetchRatesForPair({
      source: "AED",
      target: "INR",
      startDate,
      endDate,
      fetcher,
    });
    // 83.05 / 3.6725 = 22.6140912...
    const expected = new Prisma.Decimal("83.05").div(AED_PER_USD);
    expect(result["2024-01-02"].toString()).toBe(expected.toString());
  });

  it("derives INR→AED via USD peg (target→AED = source→USD * 3.6725)", async () => {
    // For INR→AED we ask Frankfurter for INR→USD, then multiply by peg.
    const fetcher = fakeFetcher({
      "2024-01-02": { USD: 0.01204 }, // INR→USD on this date
    });
    const result = await fetchRatesForPair({
      source: "INR",
      target: "AED",
      startDate,
      endDate,
      fetcher,
    });
    const expected = new Prisma.Decimal("0.01204").mul(AED_PER_USD);
    expect(result["2024-01-02"].toString()).toBe(expected.toString());
  });

  it("AED↔USD uses the fixed peg without an API call", async () => {
    let called = 0;
    const fetcher: FrankfurterFetcher = async () => {
      called += 1;
      return {
        amount: 1,
        base: "X",
        start_date: "x",
        end_date: "x",
        rates: {},
      };
    };

    const aedToUsd = await fetchRatesForPair({
      source: "AED",
      target: "USD",
      startDate,
      endDate,
      fetcher,
    });
    const usdToAed = await fetchRatesForPair({
      source: "USD",
      target: "AED",
      startDate,
      endDate,
      fetcher,
    });

    expect(called).toBe(0);
    // 1 / 3.6725
    expect(Object.values(aedToUsd)[0].toString()).toBe(
      new Prisma.Decimal(1).div(AED_PER_USD).toString(),
    );
    // 3.6725
    expect(Object.values(usdToAed)[0].toString()).toBe(AED_PER_USD.toString());
  });

  it("skips dates where target is absent from the Frankfurter response", async () => {
    const fetcher = fakeFetcher({
      "2024-01-02": { INR: 83.05 },
      "2024-01-03": { EUR: 92.0 }, // INR missing — ignore this row
    });
    const result = await fetchRatesForPair({
      source: "USD",
      target: "INR",
      startDate,
      endDate,
      fetcher,
    });
    expect(Object.keys(result)).toEqual(["2024-01-02"]);
  });
});
