"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

export type NudgeKind =
  | "ptp_due"
  | "stale_followup"
  | "digest_pending"
  | "reconciliation_unmatched";

export type NudgeCardProps = {
  id: string;
  kind: NudgeKind;
  title: string;
  description: string;
  href: string;
  count?: number;
  onSnooze?: (id: string, durationMinutes: number) => void;
};

const SNOOZE_OPTIONS = [
  { label: "1h", minutes: 60 },
  { label: "4h", minutes: 240 },
  { label: "Tomorrow", minutes: null },
] as const;

export function nudgeSnoozeKey(id: string) {
  return `receivables_nudge_snoozed_${id}`;
}

function tomorrowExpiry(now: Date) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

function expiryForOption(label: string) {
  const now = new Date();
  const option = SNOOZE_OPTIONS.find((item) => item.label === label);
  if (!option) return null;

  if (option.minutes === null) {
    const expiry = tomorrowExpiry(now);
    return {
      expiry,
      durationMinutes: Math.max(1, Math.ceil((expiry - now.getTime()) / 60000)),
    };
  }

  return {
    expiry: now.getTime() + option.minutes * 60_000,
    durationMinutes: option.minutes,
  };
}

export function NudgeCard({
  id,
  title,
  description,
  href,
  count,
  onSnooze,
}: NudgeCardProps) {
  function handleSnooze(value: string) {
    const result = expiryForOption(value);
    if (!result) return;

    try {
      localStorage.setItem(nudgeSnoozeKey(id), String(result.expiry));
    } catch {
      return;
    }

    onSnooze?.(id, result.durationMinutes);
  }

  return (
    <section className="flex flex-col gap-[var(--spacing-3)] rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-surface)] px-[var(--spacing-4)] py-[var(--spacing-3)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[var(--spacing-2)]">
          <h2 className="text-sm font-medium text-[var(--color-text)]">
            {title}
          </h2>
          {typeof count === "number" ? (
            <span className="rounded-[var(--radius-pill)] bg-[var(--color-bg-muted)] px-[var(--spacing-2)] py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
              {count}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-[var(--spacing-2)]">
        <select
          aria-label={`Snooze ${title}`}
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border-medium)] bg-[var(--color-surface)] px-[var(--spacing-2)] text-xs text-[var(--color-text-muted)]"
          defaultValue=""
          onChange={(event) => {
            handleSnooze(event.target.value);
            event.target.value = "";
          }}
        >
          <option disabled value="">
            Snooze
          </option>
          {SNOOZE_OPTIONS.map((option) => (
            <option key={option.label} value={option.label}>
              {option.label}
            </option>
          ))}
        </select>
        <Link
          className="inline-flex h-8 items-center gap-[var(--spacing-1)] rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-[var(--spacing-3)] text-xs font-medium text-white hover:bg-[var(--color-accent-strong)]"
          href={href}
        >
          Open
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
