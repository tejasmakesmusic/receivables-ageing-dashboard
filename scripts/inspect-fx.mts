import { getPrisma } from "@/lib/prisma";

async function main() {
  const p = getPrisma();

  const users = await p.$queryRawUnsafe<
    Array<{ id: string; email: string; role: string }>
  >(`SELECT id, email, role::text FROM users ORDER BY created_at ASC LIMIT 5`);
  console.log("Users (first 5):");
  for (const u of users) console.log(" ", u);

  const fxPairs = await p.$queryRawUnsafe<
    Array<{
      from_ccy: string;
      to_ccy: string;
      n: number;
      latest: string;
      open: number;
    }>
  >(`
    SELECT from_ccy, to_ccy,
           COUNT(*)::int AS n,
           MAX(effective_from)::text AS latest,
           SUM(CASE WHEN effective_to IS NULL THEN 1 ELSE 0 END)::int AS open
    FROM fx_rates GROUP BY from_ccy, to_ccy ORDER BY from_ccy, to_ccy
  `);
  console.log("fx_rates pairs:", fxPairs);

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
