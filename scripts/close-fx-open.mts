/**
 * One-off: close a currently-OPEN fx_rates row per ADR-0015 so a
 * subsequent backfill can append rates around it without tripping
 * the uq_fx_rates_pair_open partial unique.
 *
 *   npx tsx scripts/close-fx-open.mts \
 *     --pair AED:INR --close-at 2026-04-01 --actor <user-uuid>
 *
 * Only sets `effective_to`; rate / effective_from / currencies are
 * untouched. Writes an audit_log row (action=fx_rate.close).
 */
import { closeOpenFxRate } from "@/server/fx/backfill";
import { getPrisma } from "@/lib/prisma";

interface Args {
  pair: { source: string; target: string };
  closeAt: Date;
  actor: string;
}

function parseArgs(argv: string[]): Args {
  let pair: { source: string; target: string } | undefined;
  let closeAt: Date | undefined;
  let actor: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--pair" && next) {
      const [s, t] = next.split(":");
      pair = { source: s.toUpperCase(), target: t.toUpperCase() };
      i += 1;
    } else if (arg === "--close-at" && next) {
      closeAt = new Date(`${next}T00:00:00.000Z`);
      i += 1;
    } else if (arg === "--actor" && next) {
      actor = next;
      i += 1;
    }
  }
  if (!pair || !closeAt || !actor) {
    throw new Error("Required: --pair SRC:TGT --close-at YYYY-MM-DD --actor <uuid>");
  }
  return { pair, closeAt, actor };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Closing OPEN ${args.pair.source}→${args.pair.target} at ${args.closeAt.toISOString().slice(0, 10)} (actor=${args.actor})`,
  );
  const result = await closeOpenFxRate({
    fromCcy: args.pair.source,
    toCcy: args.pair.target,
    closeAt: args.closeAt,
    actorUserId: args.actor,
  });
  console.log(result);
  await getPrisma().$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
