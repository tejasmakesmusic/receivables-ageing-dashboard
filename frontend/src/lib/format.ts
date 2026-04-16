/**
 * Display formatters per spec §11 (IST display, INR/AED native).
 * Real values in Milestone 4 when Dashboard lands.
 */

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatAED(amount: number): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Always render dates in Asia/Kolkata (IST) per spec §11. */
export function formatISTDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
