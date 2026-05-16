/**
 * ADR-0014 — CLI runner for the FX backfill.
 *
 *   # Discover pairs from currently-OPEN invoices (post-publish use):
 *   npx tsx scripts/backfill-fx.mts
 *
 *   # Explicit pair + start date (pre-publish seed):
 *   npx tsx scripts/backfill-fx.mts --pair AED:INR --from 2023-01-01
 *   npx tsx scripts/backfill-fx.mts --pair USD:INR --from 2023-01-01
 *
 *   # Override the target currency (default INR):
 *   FX_TARGET=USD npx tsx scripts/backfill-fx.mts
 *
 * Walks every distinct (source_currency, target) pair represented by
 * currently-open invoices and inserts ECB-quality daily rates from
 * frankfurter.app into fx_rates. AED rates are derived from the
 * UAE Central Bank USD peg.
 */
import {
  backfillFromOpenInvoices,
  backfillFxPair,
} from "@/server/fx/backfill";
import { getPrisma } from "@/lib/prisma";

interface ParsedArgs {
  pair?: { source: string; target: string };
  from?: Date;
  to?: Date;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--pair" && next) {
      const [source, target] = next.split(":");
      if (!source || !target) {
        throw new Error(`--pair must be SOURCE:TARGET (e.g. AED:INR), got ${next}`);
      }
      out.pair = {
        source: source.toUpperCase(),
        target: target.toUpperCase(),
      };
      i += 1;
    } else if (arg === "--from" && next) {
      out.from = new Date(`${next}T00:00:00.000Z`);
      if (Number.isNaN(out.from.getTime())) {
        throw new Error(`--from must be YYYY-MM-DD, got ${next}`);
      }
      i += 1;
    } else if (arg === "--to" && next) {
      out.to = new Date(`${next}T00:00:00.000Z`);
      if (Number.isNaN(out.to.getTime())) {
        throw new Error(`--to must be YYYY-MM-DD, got ${next}`);
      }
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.pair) {
    const from = args.from;
    const to = args.to ?? new Date();
    to.setUTCHours(0, 0, 0, 0);
    if (!from) {
      throw new Error("--pair requires --from YYYY-MM-DD");
    }
    console.log(
      `Backfilling ${args.pair.source}→${args.pair.target} from ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
    );
    const result = await backfillFxPair({
      source: args.pair.source,
      target: args.pair.target,
      startDate: from,
      endDate: to,
    });
    console.log(
      `  inserted=${result.inserted} skipped=${result.skipped} (${result.insertedDates[0] ?? "—"} .. ${result.insertedDates.at(-1) ?? "—"})`,
    );
  } else {
    const target = (process.env.FX_TARGET ?? "INR").toUpperCase();
    console.log(`Backfilling FX rates from OPEN invoices → ${target}`);
    const result = await backfillFromOpenInvoices({ target });
    if (result.pairs.length === 0 && result.skippedPairs.length === 0) {
      console.log(
        "  (no work to do — `invoices` table has no OPEN rows in non-target currencies; use --pair to seed explicitly before first publish)",
      );
    }
    for (const pair of result.pairs) {
      console.log(
        `  ${pair.source}→${pair.target}: inserted=${pair.inserted} skipped=${pair.skipped} (${pair.insertedDates[0] ?? "—"} .. ${pair.insertedDates.at(-1) ?? "—"})`,
      );
    }
    for (const skipped of result.skippedPairs) {
      console.log(`  ${skipped.source}→${target}: SKIPPED — ${skipped.reason}`);
    }
  }

  await getPrisma().$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
