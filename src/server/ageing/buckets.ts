export type AgeingBucket =
  | "NOT_DUE"
  | "DUE_TODAY"
  | "0_30"
  | "31_60"
  | "61_90"
  | "90_PLUS";

interface CalculateAgeingInput {
  invoiceDate: string;
  creditDays: number;
  asOfDate: string;
}

export interface AgeingResult {
  dueDate: Date;
  overdueDays: number;
  bucket: AgeingBucket;
}

export function addDaysUtc(dateValue: string, days: number): Date {
  const base = new Date(`${dateValue}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base;
}

export function daysBetweenUtc(from: Date, to: Date): number {
  const msPerDay = 86400000;
  const start = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((end - start) / msPerDay);
}

export function ageingBucket(overdueDays: number): AgeingBucket {
  if (overdueDays < 0) return "NOT_DUE";
  if (overdueDays === 0) return "DUE_TODAY";
  if (overdueDays <= 30) return "0_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  return "90_PLUS";
}

export function calculateAgeing(input: CalculateAgeingInput): AgeingResult {
  const dueDate = addDaysUtc(input.invoiceDate, input.creditDays);
  const asOfDate = new Date(`${input.asOfDate}T00:00:00.000Z`);
  const overdueDays = daysBetweenUtc(dueDate, asOfDate);

  return {
    dueDate,
    overdueDays,
    bucket: ageingBucket(overdueDays),
  };
}
