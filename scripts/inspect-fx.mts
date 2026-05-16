import { getPrisma } from "@/lib/prisma";

async function main() {
  const p = getPrisma();

  const openByCurrency = await p.$queryRawUnsafe<
    Array<{ currency: string; earliest: Date | null; n: number }>
  >(`
    SELECT currency, MIN(invoice_date) AS earliest, COUNT(*)::int AS n
    FROM invoices WHERE status = 'OPEN' GROUP BY currency ORDER BY currency
  `);
  console.log("OPEN invoices by currency:", openByCurrency);

  const allInvoices = await p.$queryRawUnsafe<
    Array<{ status: string; n: number }>
  >(`SELECT status, COUNT(*)::int AS n FROM invoices GROUP BY status`);
  console.log("Invoices by status:", allInvoices);

  const fxPairs = await p.$queryRawUnsafe<
    Array<{
      from_ccy: string;
      to_ccy: string;
      n: number;
      earliest: string;
      latest: string;
    }>
  >(`
    SELECT from_ccy, to_ccy,
           COUNT(*)::int AS n,
           MIN(effective_from)::text AS earliest,
           MAX(effective_from)::text AS latest
    FROM fx_rates GROUP BY from_ccy, to_ccy ORDER BY from_ccy, to_ccy
  `);
  console.log("fx_rates pairs:", fxPairs);

  // Spot-check the rate the dashboard will resolve for Tawi Bhardwaj's
  // 2023-12-06 invoice (oldest open invoice in the Mantarav pull).
  const spot = await p.$queryRawUnsafe<
    Array<{ rate: string; effective_from: string; source: string }>
  >(`
    SELECT rate::text, effective_from::text, source::text
    FROM fx_rates
    WHERE from_ccy='AED' AND to_ccy='INR' AND effective_from <= '2023-12-06'
    ORDER BY effective_from DESC LIMIT 1
  `);
  console.log("Resolved AED→INR for 2023-12-06:", spot);

  const snapshots = await p.$queryRawUnsafe<
    Array<{
      id: string;
      status: string;
      source_hint: string;
      entity_id: string;
      as_of_date: string | null;
      created_at: string;
    }>
  >(`
    SELECT id, status, source_hint, entity_id, as_of_date::text, created_at::text
    FROM snapshots ORDER BY created_at DESC LIMIT 10
  `);
  console.log("snapshots (latest 10):");
  for (const s of snapshots) {
    console.log(" ", s);
  }

  const entities = await p.$queryRawUnsafe<
    Array<{ id: string; name: string; base_currency: string }>
  >(`SELECT id, name, base_currency FROM entities ORDER BY name`);
  console.log("entities:", entities);


  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
