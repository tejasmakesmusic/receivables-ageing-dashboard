/**
 * ADR-0014 — thin client for frankfurter.app (ECB-backed FX feed).
 *
 * Free, no API key. Endpoints:
 *   GET https://api.frankfurter.app/{date}?from=X&to=Y
 *   GET https://api.frankfurter.app/{from}..{to}?from=X&to=Y   (timeseries)
 *
 * Caveats — these shape the backfill logic, NOT the client:
 *   • Frankfurter is ECB-sourced and does NOT quote AED. AED is handled
 *     elsewhere via the UAE Central Bank's USD peg (3.6725 AED = 1 USD,
 *     fixed since 1997).
 *   • Frankfurter publishes weekday rates only. The `rates` map will
 *     skip weekends and ECB holidays — callers must not assume one
 *     entry per calendar day.
 *   • The free tier has no documented rate limit; one timeseries call
 *     for a multi-year span returns ~250 rows per year. We make one
 *     call per (source → target) pair, not one per date.
 */

export interface FrankfurterTimeseriesResponse {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  /** ISO date (YYYY-MM-DD) → currency code → rate */
  rates: Record<string, Record<string, number>>;
}

export interface FrankfurterFetcher {
  (input: {
    base: string;
    target: string;
    startDate: string;
    endDate: string;
  }): Promise<FrankfurterTimeseriesResponse>;
}

const BASE_URL = "https://api.frankfurter.app";

function assertDateOnly(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD; got ${value}`);
  }
}

export const fetchFrankfurterTimeseries: FrankfurterFetcher = async ({
  base,
  target,
  startDate,
  endDate,
}) => {
  assertDateOnly(startDate, "startDate");
  assertDateOnly(endDate, "endDate");
  if (base === target) {
    throw new Error(
      "fetchFrankfurterTimeseries: base and target must differ",
    );
  }

  const url = `${BASE_URL}/${startDate}..${endDate}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(target)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Frankfurter HTTP ${response.status} for ${base}->${target}: ${await response.text()}`,
    );
  }
  return (await response.json()) as FrankfurterTimeseriesResponse;
};
