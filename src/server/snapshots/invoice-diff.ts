import { Prisma } from "@/generated/prisma/client";

/**
 * PR 3 / Gap 3 — pure helper that diffs a prior published invoice against
 * the about-to-be-written payload and returns one delta record per changed
 * field. Emits zero records when nothing material drifted.
 *
 * Compared fields:
 *   • amount             (Decimal — semantic equality, not string equality)
 *   • due_date           (Date — day equality in UTC)
 *   • credit_days_applied (Int)
 *   • invoice_date       (Date)
 *   • currency           (String)
 *
 * Deliberately NOT compared:
 *   • raw_row_json / xero_metadata — noise; vendor-specific extras.
 *   • credit_days_source — clerical, not a material change.
 *   • status, settled_snapshot_id — managed by other code paths.
 *   • updated_at — meta.
 */
export type InvoiceDiffField =
  | "amount"
  | "due_date"
  | "credit_days"
  | "invoice_date"
  | "currency";

export interface InvoiceSnapshotShape {
  amount: Prisma.Decimal | string | number;
  due_date: Date;
  credit_days_applied: number;
  invoice_date: Date;
  currency: string;
}

export interface InvoiceDelta {
  field: InvoiceDiffField;
  before: string | number;
  after: string | number;
}

function toAmountString(v: Prisma.Decimal | string | number): string {
  if (typeof v === "string") return new Prisma.Decimal(v).toFixed(2);
  if (typeof v === "number") return new Prisma.Decimal(v).toFixed(2);
  return v.toFixed(2);
}

function toDayString(v: Date): string {
  return v.toISOString().slice(0, 10);
}

export function diffInvoice(
  prior: InvoiceSnapshotShape,
  next: InvoiceSnapshotShape,
): InvoiceDelta[] {
  const out: InvoiceDelta[] = [];

  const priorAmount = toAmountString(prior.amount);
  const nextAmount = toAmountString(next.amount);
  if (priorAmount !== nextAmount) {
    out.push({ field: "amount", before: priorAmount, after: nextAmount });
  }

  const priorDue = toDayString(prior.due_date);
  const nextDue = toDayString(next.due_date);
  if (priorDue !== nextDue) {
    out.push({ field: "due_date", before: priorDue, after: nextDue });
  }

  if (prior.credit_days_applied !== next.credit_days_applied) {
    out.push({
      field: "credit_days",
      before: prior.credit_days_applied,
      after: next.credit_days_applied,
    });
  }

  const priorInv = toDayString(prior.invoice_date);
  const nextInv = toDayString(next.invoice_date);
  if (priorInv !== nextInv) {
    out.push({ field: "invoice_date", before: priorInv, after: nextInv });
  }

  if (prior.currency !== next.currency) {
    out.push({
      field: "currency",
      before: prior.currency,
      after: next.currency,
    });
  }

  return out;
}
