/**
 * Display formatters per spec §11 (IST display, INR/AED native).
 */

export function formatINR(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatAED(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatCurrency(
  amount: number | string,
  currency: "INR" | "AED",
): string {
  return currency === "AED" ? formatAED(amount) : formatINR(amount);
}

/** Always render dates in Asia/Kolkata (IST) per spec §11. */
export function formatISTDate(iso: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function formatISTDateTime(iso: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function formatPct(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}
