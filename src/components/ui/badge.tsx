import * as React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "current"
  | "1-30"
  | "31-60"
  | "61-90"
  | "90+";

const variantClasses: Record<BadgeVariant, string> = {
  default: "border border-[var(--color-text)] bg-[var(--color-text)] text-white",
  secondary:
    "border border-[var(--color-status-neutral-border)] bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]",
  destructive:
    "border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]",
  accent:
    "border border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)] text-[var(--color-status-info-text)]",
  success:
    "border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]",
  warning:
    "border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]",
  danger:
    "border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]",
  current:
    "border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]",
  "1-30":
    "border border-[var(--color-status-info-border)] bg-[var(--color-status-info-bg)] text-[var(--color-status-info-text)]",
  "31-60":
    "border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]",
  "61-90":
    "border border-[var(--color-status-alert-border)] bg-[var(--color-status-alert-bg)] text-[var(--color-status-alert-text)]",
  "90+":
    "border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
