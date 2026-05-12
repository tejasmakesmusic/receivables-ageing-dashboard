export function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) {
    return "-";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(
  value: number | string | null | undefined,
  currency = "INR",
): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function formatCurrencyCompact(
  value: number | string | null | undefined,
  currency = "INR",
): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  const num = Number(value);
  const absNum = Math.abs(num);

  let formatted: string;
  if (absNum >= 10_000_000) {
    // Crores (10M+)
    formatted = (num / 10_000_000).toFixed(2).replace(/\.?0+$/, "");
    formatted = `${formatted} Cr`;
  } else if (absNum >= 100_000) {
    // Lakhs (1L+)
    formatted = (num / 100_000).toFixed(2).replace(/\.?0+$/, "");
    formatted = `${formatted} L`;
  } else {
    // Standard currency format
    return formatCurrency(value, currency);
  }

  const currencySymbol = currency === "INR" ? "₹" : currency;
  return `${currencySymbol}${formatted}`;
}
