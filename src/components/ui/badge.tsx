import * as React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

// All supported variant keys
export type BadgeVariant =
  // Legacy
  | "default"
  | "secondary"
  | "destructive"
  // Semantic
  | "accent"
  | "success"
  | "warning"
  | "danger"
  // Ageing buckets
  | "current"
  | "1-30"
  | "31-60"
  | "61-90"
  | "90+";

const variantClasses: Record<BadgeVariant, string> = {
  // Legacy (unchanged)
  default:     "bg-slate-900 text-white",
  secondary:   "border border-slate-300 bg-slate-100 text-slate-900",
  destructive: "bg-red-100 text-red-700 border border-red-200",

  // Semantic (token-based)
  accent:  "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  success: "bg-[var(--color-success-soft)] text-green-700 dark:text-green-400",
  warning: "bg-[var(--color-warning-soft)] text-yellow-700 dark:text-yellow-400",
  danger:  "bg-[var(--color-danger-soft)] text-red-700 dark:text-red-400",

  // Ageing buckets
  current: "bg-[var(--color-success-soft)] text-green-700 dark:text-green-400",
  "1-30":  "bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]",
  "31-60": "bg-[var(--color-warning-soft)] text-yellow-700 dark:text-yellow-400",
  "61-90": "bg-[var(--color-warning-soft)] text-orange-700 dark:text-orange-400",
  "90+":   "bg-[var(--color-danger-soft)] text-red-700 dark:text-red-400",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] px-[var(--spacing-2)] py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
