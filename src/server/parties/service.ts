import { getPrisma } from "@/lib/prisma";

export interface PartyInvoiceRow {
  invoice_id: string;
  invoice_ref: string;
  invoice_date: string;
  amount: string;
  currency: string;
  due_date: string;
  credit_days_applied: number;
  credit_days_source: string;
  status: "OPEN" | "SETTLED";
  overdue_days: number | null;
  bucket: string | null;
  outstanding_amount: string | null;
  active_exception_count: number;
}

export interface PartyResponse {
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  total_outstanding: string;
  currency_display: string;
  active_invoice_count: number;
  active_exception_count: number;
  invoices: PartyInvoiceRow[];
}

type DecimalLike = string | number | null | { toString: () => string };

function formatDecimal(value: DecimalLike): string {
  if (value == null) return "0.00";
  if (typeof value === "number") return value.toFixed(2);
  return value.toString();
}

function parseToCents(value: DecimalLike): bigint {
  const text = formatDecimal(value).trim().replace(/,/g, "");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return 0n;

  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = whole * 100n + BigInt(fraction || "0");
  return negative ? -cents : cents;
}

function formatFromCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${sign}${whole.toString()}.${fraction}`;
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function getPartyDetail(
  canonicalId: string,
): Promise<PartyResponse | null> {
  const prisma = getPrisma();

  const canonical = await prisma.parties_canonical.findUnique({
    where: { id: canonicalId },
    select: {
      id: true,
      name: true,
      entities: {
        select: {
          code: true,
        },
      },
    },
  });

  if (!canonical) {
    return null;
  }

  const openInvoices = await prisma.invoices.findMany({
    where: {
      canonical_id: canonicalId,
      status: "OPEN",
    },
    orderBy: {
      invoice_date: "desc",
    },
    include: {
      invoice_snapshots: {
        orderBy: {
          as_of_date: "desc",
        },
        take: 1,
        select: {
          outstanding_amount: true,
          overdue_days: true,
          bucket: true,
        },
      },
    },
  });

  const invoiceIds = openInvoices.map((invoice) => invoice.id);

  const invoiceExceptionCounts = invoiceIds.length
    ? await prisma.exception_tags.groupBy({
        by: ["invoice_id"],
        where: {
          invoice_id: { in: invoiceIds },
          status: "ACTIVE",
        },
        _count: {
          invoice_id: true,
        },
      })
    : [];

  const allInvoices = await prisma.invoices.findMany({
    where: {
      canonical_id: canonicalId,
    },
    select: {
      id: true,
    },
  });

  const totalActiveExceptions = allInvoices.length
    ? await prisma.exception_tags.count({
        where: {
          invoice_id: { in: allInvoices.map((invoice) => invoice.id) },
          status: "ACTIVE",
        },
      })
    : 0;

  const exceptionCountByInvoice = new Map<string, number>(
    invoiceExceptionCounts.map((row) => [
      row.invoice_id,
      row._count.invoice_id,
    ]),
  );

  const invoices: PartyInvoiceRow[] = openInvoices.map((invoice) => {
    const latestSnapshot = invoice.invoice_snapshots.at(0);

    return {
      invoice_id: invoice.id,
      invoice_ref: invoice.invoice_ref,
      invoice_date: toDateString(invoice.invoice_date),
      amount: formatDecimal(invoice.amount),
      currency: invoice.currency,
      due_date: toDateString(invoice.due_date),
      credit_days_applied: invoice.credit_days_applied,
      credit_days_source: invoice.credit_days_source,
      status: invoice.status === "SETTLED" ? "SETTLED" : "OPEN",
      overdue_days: latestSnapshot?.overdue_days ?? null,
      bucket: latestSnapshot?.bucket ?? null,
      outstanding_amount: latestSnapshot
        ? formatDecimal(latestSnapshot.outstanding_amount)
        : null,
      active_exception_count: exceptionCountByInvoice.get(invoice.id) ?? 0,
    };
  });

  const totalOutstanding = formatFromCents(
    invoices.reduce<bigint>(
      (acc, invoice) =>
        acc + parseToCents(invoice.outstanding_amount ?? invoice.amount),
      0n,
    ),
  );

  const entityCode = canonical.entities?.code ?? "UNKNOWN";

  return {
    canonical_id: canonical.id,
    canonical_name: canonical.name,
    entity_code: entityCode,
    total_outstanding: totalOutstanding,
    currency_display: entityCode === "IND" ? "INR" : "AED",
    active_invoice_count: invoices.length,
    active_exception_count: totalActiveExceptions,
    invoices,
  };
}

export async function getPartyEntityId(
  canonicalId: string,
): Promise<string | null> {
  const party = await getPrisma().parties_canonical.findUnique({
    where: { id: canonicalId },
    select: { entity_id: true },
  });

  return party?.entity_id ?? null;
}
