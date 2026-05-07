import "server-only";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { role_enum } from "@/generated/prisma/enums";

type AccountInvoiceInput = {
  active_exception_count: number;
  bucket: string | null;
  outstanding_amount: string | null;
};

export interface AccountSummary {
  active_exception_count: number;
  collection_health: "Good" | "Watch" | "At Risk";
  overdue_amount: string;
  total_outstanding: string;
  worst_bucket: string;
}

export interface AccountListRow extends AccountSummary {
  canonical_id: string;
  canonical_name: string;
  currency_display: string;
  entity_code: string;
  open_invoice_count: number;
}

const BUCKET_RANK: Record<string, number> = {
  NOT_DUE: 0,
  "0_30": 1,
  "31_60": 2,
  "61_90": 3,
  "90_PLUS": 4,
};

function toCents(value: string | null) {
  const numeric = Number(value ?? "0");
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

export function summarizeAccount({
  invoices,
}: {
  invoices: AccountInvoiceInput[];
}): AccountSummary {
  let activeExceptionCount = 0;
  let overdue = 0;
  let total = 0;
  let worstBucket = "NOT_DUE";

  for (const invoice of invoices) {
    const amount = toCents(invoice.outstanding_amount);
    const bucket = invoice.bucket ?? "NOT_DUE";
    total += amount;

    if (bucket !== "NOT_DUE") {
      overdue += amount;
    }

    if ((BUCKET_RANK[bucket] ?? 0) > (BUCKET_RANK[worstBucket] ?? 0)) {
      worstBucket = bucket;
    }

    activeExceptionCount += invoice.active_exception_count;
  }

  const collectionHealth =
    worstBucket === "90_PLUS" || activeExceptionCount > 0
      ? "At Risk"
      : worstBucket === "61_90" || worstBucket === "31_60"
        ? "Watch"
        : "Good";

  return {
    active_exception_count: activeExceptionCount,
    collection_health: collectionHealth,
    overdue_amount: fromCents(overdue),
    total_outstanding: fromCents(total),
    worst_bucket: worstBucket,
  };
}

export async function listAccounts(
  user: AuthenticatedUser,
): Promise<AccountListRow[]> {
  assertNotPending(user);

  const accounts = await getPrisma().parties_canonical.findMany({
    where:
      user.role === role_enum.ANALYST && user.entityIdScope
        ? { entity_id: user.entityIdScope }
        : {},
    orderBy: { name: "asc" },
    take: 100,
    include: {
      entities: { select: { base_currency: true, code: true } },
      invoices: {
        where: { status: "OPEN" },
        include: {
          exception_tags: {
            where: { status: "ACTIVE" },
            select: { id: true },
          },
          invoice_snapshots: {
            orderBy: { as_of_date: "desc" },
            select: { bucket: true, outstanding_amount: true },
            take: 1,
          },
        },
      },
    },
  });

  return accounts.map((account) => {
    const invoiceInputs = account.invoices.map((invoice) => ({
      active_exception_count: invoice.exception_tags.length,
      bucket: invoice.invoice_snapshots.at(0)?.bucket ?? "NOT_DUE",
      outstanding_amount:
        invoice.invoice_snapshots.at(0)?.outstanding_amount?.toString() ??
        invoice.amount.toString(),
    }));
    const summary = summarizeAccount({ invoices: invoiceInputs });

    return {
      canonical_id: account.id,
      canonical_name: account.name,
      currency_display: account.entities.base_currency,
      entity_code: account.entities.code,
      open_invoice_count: account.invoices.length,
      ...summary,
    };
  });
}
