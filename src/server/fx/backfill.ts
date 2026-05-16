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
import { createAuditLog } from "@/server/core/audit";
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

/**
 * ADR-0015 — set `effective_to` on the currently-OPEN row for a pair.
 *
 * The single permitted UPDATE path on `fx_rates`. Only `effective_to`
 * is written; rate, dates, currencies, source, created_by, created_at
 * stay immutable. Every closure writes an audit_log row so the
 * before/after of `effective_to` is observable forever.
 *
 * Idempotent: if no OPEN row exists, returns `{ closed: false }`. If
 * `close_at` falls outside the allowed band (>= effective_from of the
 * row, < any next rate's effective_from), throws — never silently
 * shortens an already-historical interval.
 */
export interface CloseOpenFxRateInput {
  fromCcy: string;
  toCcy: string;
  closeAt: Date;
  actorUserId: string;
}

export interface CloseOpenFxRateResult {
  closed: boolean;
  closedRowId?: string;
  effectiveTo?: string;
}

export async function closeOpenFxRate(
  input: CloseOpenFxRateInput,
): Promise<CloseOpenFxRateResult> {
  const prisma = getPrisma();
  const openRow = await prisma.fx_rates.findFirst({
    where: {
      from_ccy: input.fromCcy,
      to_ccy: input.toCcy,
      effective_to: null,
    },
    select: { id: true, effective_from: true },
  });
  if (!openRow) {
    return { closed: false };
  }

  if (input.closeAt < openRow.effective_from) {
    throw new Error(
      `closeOpenFxRate: closeAt ${toDateOnly(input.closeAt)} precedes effective_from ${toDateOnly(openRow.effective_from)} for ${input.fromCcy}->${input.toCcy}`,
    );
  }

  const nextRow = await prisma.fx_rates.findFirst({
    where: {
      from_ccy: input.fromCcy,
      to_ccy: input.toCcy,
      effective_from: { gt: openRow.effective_from },
    },
    orderBy: { effective_from: "asc" },
    select: { effective_from: true },
  });
  if (nextRow && input.closeAt >= nextRow.effective_from) {
    throw new Error(
      `closeOpenFxRate: closeAt ${toDateOnly(input.closeAt)} overlaps next rate at ${toDateOnly(nextRow.effective_from)} for ${input.fromCcy}->${input.toCcy}`,
    );
  }

  await prisma.fx_rates.update({
    where: { id: openRow.id },
    data: { effective_to: input.closeAt },
  });

  await createAuditLog(
    input.actorUserId,
    "fx_rate.close",
    "fx_rates",
    openRow.id,
    { effective_to: null },
    { effective_to: toDateOnly(input.closeAt) },
  );

  return {
    closed: true,
    closedRowId: openRow.id,
    effectiveTo: toDateOnly(input.closeAt),
  };
}

/**
 * Daily-tick handler — finds every distinct (from, to) pair already in
 * fx_rates with source='API' (auto-maintained pairs), then appends
 * rates for any missing dates from the latest-on-file → yesterday.
 *
 * Closes the previously-OPEN row when a strictly newer rate is about
 * to be inserted (per ADR-0015).
 *
 * Returns one summary per pair. Pairs with no missing dates report
 * `inserted: 0` and `closedPrior: false`.
 */
export interface AppendDailyRatesInput {
  actorUserId: string;
  asOf?: Date; // defaults to today (UTC)
  fetcher?: FrankfurterFetcher;
}

export interface AppendDailyRatesPair {
  source: string;
  target: string;
  inserted: number;
  skipped: number;
  closedPrior: boolean;
  fromDate?: string;
  toDate?: string;
}

export interface AppendDailyRatesResult {
  asOf: string;
  pairs: AppendDailyRatesPair[];
  errors: Array<{ source: string; target: string; reason: string }>;
}

export async function appendDailyRates(
  input: AppendDailyRatesInput,
): Promise<AppendDailyRatesResult> {
  const prisma = getPrisma();
  const fetcher = input.fetcher ?? fetchFrankfurterTimeseries;
  const asOf = new Date(input.asOf ?? new Date());
  asOf.setUTCHours(0, 0, 0, 0);

  // Yesterday — ECB doesn't publish today's rate until late afternoon
  // CET. Pulling [latest+1 .. yesterday] avoids racing today's
  // publication window.
  const yesterday = new Date(asOf);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const pairs = await prisma.$queryRawUnsafe<
    Array<{
      from_ccy: string;
      to_ccy: string;
      latest_from: Date;
    }>
  >(`
    SELECT from_ccy, to_ccy, MAX(effective_from) AS latest_from
    FROM fx_rates
    WHERE source = 'API'
    GROUP BY from_ccy, to_ccy
  `);

  const result: AppendDailyRatesResult = {
    asOf: toDateOnly(asOf),
    pairs: [],
    errors: [],
  };

  for (const pair of pairs) {
    try {
      const startDate = new Date(pair.latest_from);
      startDate.setUTCDate(startDate.getUTCDate() + 1);
      if (startDate > yesterday) {
        result.pairs.push({
          source: pair.from_ccy,
          target: pair.to_ccy,
          inserted: 0,
          skipped: 0,
          closedPrior: false,
        });
        continue;
      }

      const ratesByDate = await fetchRatesForPair({
        source: pair.from_ccy,
        target: pair.to_ccy,
        startDate,
        endDate: yesterday,
        fetcher,
      });
      const sortedDates = Object.keys(ratesByDate).sort();
      if (sortedDates.length === 0) {
        result.pairs.push({
          source: pair.from_ccy,
          target: pair.to_ccy,
          inserted: 0,
          skipped: 0,
          closedPrior: false,
        });
        continue;
      }

      // Close the currently-OPEN row at (firstNewDate - 1) so the new
      // earliest insert can take its place as OPEN.
      const firstNewDate = sortedDates[0];
      const closeAt = dayBefore(firstNewDate);
      const closure = await closeOpenFxRate({
        fromCcy: pair.from_ccy,
        toCcy: pair.to_ccy,
        closeAt,
        actorUserId: input.actorUserId,
      });

      let inserted = 0;
      let skipped = 0;
      for (let i = 0; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        const isLast = i === sortedDates.length - 1;
        const nextDate = isLast ? null : sortedDates[i + 1];
        try {
          await prisma.fx_rates.create({
            data: {
              id: createId(),
              from_ccy: pair.from_ccy,
              to_ccy: pair.to_ccy,
              rate: ratesByDate[date],
              effective_from: fromDateOnly(date),
              effective_to: nextDate ? dayBefore(nextDate) : null,
              source: "API",
            },
          });
          inserted += 1;
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            skipped += 1;
            continue;
          }
          throw err;
        }
      }

      result.pairs.push({
        source: pair.from_ccy,
        target: pair.to_ccy,
        inserted,
        skipped,
        closedPrior: closure.closed,
        fromDate: sortedDates[0],
        toDate: sortedDates[sortedDates.length - 1],
      });
    } catch (err) {
      result.errors.push({
        source: pair.from_ccy,
        target: pair.to_ccy,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
