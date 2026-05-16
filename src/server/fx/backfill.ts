/**
 * ADR-0014 — backfill historical FX rates into `fx_rates` from
 * frankfurter.app, with AED derived from the USD peg.
 *
 * Insert-only. Existing rows are never updated (per CLAUDE.md "Mutate
 * FX rows after creation"), so any pre-existing OPEN rate (`effective_to
 * IS NULL`) for a pair causes the backfill to halt for that pair —
 * resolve manually via the admin UI before re-running.
 *
 * Date semantics:
 *   • One inserted row per ECB-published date in the requested range.
 *   • `effective_to` is set to the day before the next published date,
 *     except for the latest row which keeps `effective_to = NULL`.
 *     This honors the `uq_fx_rates_pair_open` partial unique while
 *     leaving the dashboard's `effective_from <= invoice_date ORDER BY
 *     effective_from DESC LIMIT 1` lookup unchanged.
 *   • Dashboard lookup falls back to the most recent rate ≤ invoice
 *     date, so weekends and holidays (no ECB publication) are covered
 *     by the prior business day.
 */

import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import {
  fetchFrankfurterTimeseries,
  type FrankfurterFetcher,
} from "@/server/fx/frankfurter";

/** UAE Central Bank peg, in effect since November 1997. */
export const AED_PER_USD = new Prisma.Decimal("3.6725");

export interface BackfillPairInput {
  source: string;
  target: string;
  startDate: Date;
  endDate: Date;
  fetcher?: FrankfurterFetcher;
}

export interface BackfillPairResult {
  source: string;
  target: string;
  inserted: number;
  skipped: number;
  insertedDates: string[];
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function fromDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayBefore(value: string): Date {
  const d = fromDateOnly(value);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * Returns a map of ISO date → rate (source → target). For AED, fetches
 * USD timeseries and derives via the USD peg. For other currencies,
 * fetches directly from Frankfurter.
 */
export async function fetchRatesForPair(
  input: BackfillPairInput,
): Promise<Record<string, Prisma.Decimal>> {
  if (input.source === input.target) {
    return {};
  }
  const fetcher = input.fetcher ?? fetchFrankfurterTimeseries;
  const startDate = toDateOnly(input.startDate);
  const endDate = toDateOnly(input.endDate);
  const ratesByDate: Record<string, Prisma.Decimal> = {};

  if (input.source === "AED") {
    // 1 USD = AED_PER_USD AED  →  1 AED = 1 / AED_PER_USD USD
    //   AED → target  =  (USD → target) / AED_PER_USD
    // We special-case AED → USD too: 1 / AED_PER_USD (constant, no API call).
    if (input.target === "USD") {
      ratesByDate[startDate] = new Prisma.Decimal(1).div(AED_PER_USD);
      return ratesByDate;
    }
    const usd = await fetcher({
      base: "USD",
      target: input.target,
      startDate,
      endDate,
    });
    for (const [date, ratesObj] of Object.entries(usd.rates)) {
      const usdRate = ratesObj[input.target];
      if (typeof usdRate === "number" && Number.isFinite(usdRate)) {
        ratesByDate[date] = new Prisma.Decimal(usdRate).div(AED_PER_USD);
      }
    }
    return ratesByDate;
  }

  if (input.target === "AED") {
    // target → AED  =  (source → USD) * AED_PER_USD
    if (input.source === "USD") {
      ratesByDate[startDate] = AED_PER_USD;
      return ratesByDate;
    }
    const usd = await fetcher({
      base: input.source,
      target: "USD",
      startDate,
      endDate,
    });
    for (const [date, ratesObj] of Object.entries(usd.rates)) {
      const usdRate = ratesObj.USD;
      if (typeof usdRate === "number" && Number.isFinite(usdRate)) {
        ratesByDate[date] = new Prisma.Decimal(usdRate).mul(AED_PER_USD);
      }
    }
    return ratesByDate;
  }

  // Neither side is AED — direct Frankfurter call.
  const direct = await fetcher({
    base: input.source,
    target: input.target,
    startDate,
    endDate,
  });
  for (const [date, ratesObj] of Object.entries(direct.rates)) {
    const v = ratesObj[input.target];
    if (typeof v === "number" && Number.isFinite(v)) {
      ratesByDate[date] = new Prisma.Decimal(v);
    }
  }
  return ratesByDate;
}

export async function backfillFxPair(
  input: BackfillPairInput,
): Promise<BackfillPairResult> {
  const result: BackfillPairResult = {
    source: input.source,
    target: input.target,
    inserted: 0,
    skipped: 0,
    insertedDates: [],
  };
  if (input.source === input.target) {
    return result;
  }

  const ratesByDate = await fetchRatesForPair(input);
  const sortedDates = Object.keys(ratesByDate).sort();
  if (sortedDates.length === 0) {
    return result;
  }

  // Guard: cannot insert if there's already an open rate for this pair,
  // because `uq_fx_rates_pair_open` enforces a single `effective_to IS
  // NULL` row, and we are forbidden from updating it.
  const existingOpen = await getPrisma().fx_rates.findFirst({
    where: {
      from_ccy: input.source,
      to_ccy: input.target,
      effective_to: null,
    },
    select: { id: true, effective_from: true },
  });
  if (existingOpen) {
    throw new Error(
      `Open rate already exists for ${input.source}->${input.target} (effective_from=${toDateOnly(existingOpen.effective_from)}). Close it manually before backfill.`,
    );
  }

  const prisma = getPrisma();
  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const isLast = i === sortedDates.length - 1;
    const nextDate = isLast ? null : sortedDates[i + 1];

    try {
      await prisma.fx_rates.create({
        data: {
          id: createId(),
          from_ccy: input.source,
          to_ccy: input.target,
          // Decimal(18,8) — well beyond the precision of any reasonable
          // ECB quote, no rounding concerns.
          rate: ratesByDate[date],
          effective_from: fromDateOnly(date),
          effective_to: nextDate ? dayBefore(nextDate) : null,
          source: "API",
        },
      });
      result.inserted += 1;
      result.insertedDates.push(date);
    } catch (err) {
      // P2002 = unique constraint violation. Treat as "already exists,
      // skip" — the triple unique on (from, to, effective_from) means
      // a row with this exact date was created by a prior run.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        result.skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return result;
}

export interface BackfillAllInput {
  target: string;
  fetcher?: FrankfurterFetcher;
  /** Optional override for the earliest date considered. */
  earliestFloor?: Date;
}

export interface BackfillAllResult {
  target: string;
  pairs: BackfillPairResult[];
  skippedPairs: Array<{ source: string; reason: string }>;
}

/**
 * Discover every (currency, target) pair represented by currently-open
 * invoices and backfill each one. Date range = MIN(invoice_date) for
 * that currency → today.
 */
export async function backfillFromOpenInvoices(
  input: BackfillAllInput,
): Promise<BackfillAllResult> {
  const rows = await getPrisma().$queryRawUnsafe<
    Array<{ currency: string; earliest: Date }>
  >(`
    SELECT currency, MIN(invoice_date) AS earliest
    FROM invoices
    WHERE status = 'OPEN'
    GROUP BY currency
  `);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: BackfillAllResult = {
    target: input.target,
    pairs: [],
    skippedPairs: [],
  };

  for (const row of rows) {
    if (row.currency === input.target) {
      continue;
    }
    const startDate =
      input.earliestFloor && input.earliestFloor > row.earliest
        ? input.earliestFloor
        : row.earliest;
    try {
      const result = await backfillFxPair({
        source: row.currency,
        target: input.target,
        startDate,
        endDate: today,
        fetcher: input.fetcher,
      });
      out.pairs.push(result);
    } catch (err) {
      out.skippedPairs.push({
        source: row.currency,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}
