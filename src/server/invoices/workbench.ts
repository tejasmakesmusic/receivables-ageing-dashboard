export const AGEING_BUCKETS = [
  { bucket: "NOT_DUE", label: "Current" },
  { bucket: "0_30", label: "1-30 Days" },
  { bucket: "31_60", label: "31-60 Days" },
  { bucket: "61_90", label: "61-90 Days" },
  { bucket: "90_PLUS", label: "91+ Days" },
] as const;

export type AgeingBucket = (typeof AGEING_BUCKETS)[number]["bucket"];

export interface InvoiceBucketInput {
  amount: string | number | null;
  bucket: string | null;
}

export interface InvoiceBucketSummary {
  amount: number;
  bucket: AgeingBucket;
  count: number;
  label: string;
  percent: number;
}

function toNumber(value: string | number | null): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function buildBucketSummaries(
  invoices: InvoiceBucketInput[],
): InvoiceBucketSummary[] {
  const rows = new Map<AgeingBucket, { amount: number; count: number }>(
    AGEING_BUCKETS.map(({ bucket }) => [bucket, { amount: 0, count: 0 }]),
  );

  for (const invoice of invoices) {
    if (!invoice.bucket || !rows.has(invoice.bucket as AgeingBucket)) {
      continue;
    }

    const bucket = invoice.bucket as AgeingBucket;
    const current = rows.get(bucket);

    if (!current) {
      continue;
    }

    current.amount += toNumber(invoice.amount);
    current.count += 1;
  }

  const total = Array.from(rows.values()).reduce(
    (sum, row) => sum + row.amount,
    0,
  );

  return AGEING_BUCKETS.map(({ bucket, label }) => {
    const row = rows.get(bucket) ?? { amount: 0, count: 0 };

    return {
      amount: row.amount,
      bucket,
      count: row.count,
      label,
      percent: total > 0 ? Math.round((row.amount / total) * 100) : 0,
    };
  });
}
