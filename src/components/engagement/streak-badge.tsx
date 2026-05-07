"use client";

import { Flame } from "lucide-react";
import { useEffect, useState } from "react";

type StreakPayload = {
  current_streak?: unknown;
  streak_days?: unknown;
  streak?: unknown;
  freeze_today?: unknown;
};

type StreakState = {
  days: number;
  freezeToday: boolean;
};

const STREAK_TOOLTIP =
  "Streak counts working days where you completed your due follow-ups on time. Weekends and approved freezes don't break it.";

function numberFromPayload(payload: StreakPayload) {
  const value =
    payload.current_streak ?? payload.streak_days ?? payload.streak ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

export function StreakBadge() {
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStreak() {
      try {
        const response = await fetch("/api/engagement/streak", {
          signal: controller.signal,
        });

        if (response.status === 404) {
          setHidden(true);
          return;
        }

        if (!response.ok) {
          setHidden(true);
          return;
        }

        const payload = (await response.json()) as StreakPayload;
        setStreak({
          days: numberFromPayload(payload),
          freezeToday: payload.freeze_today === true,
        });
      } catch {
        if (!controller.signal.aborted) {
          setHidden(true);
        }
      }
    }

    void loadStreak();

    return () => controller.abort();
  }, []);

  if (hidden || !streak) {
    return null;
  }

  return (
    <div
      aria-label={`${streak.days} day streak. ${
        streak.freezeToday ? "Frozen today. " : ""
      }${STREAK_TOOLTIP}`}
      className="group relative inline-flex min-h-8 items-center gap-[var(--spacing-2)] rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--spacing-3)] py-1 text-xs text-[var(--color-text)]"
      tabIndex={0}
      title={STREAK_TOOLTIP}
    >
      <Flame
        aria-hidden="true"
        className="h-4 w-4 text-[var(--color-warning)]"
      />
      <span className="font-medium">{streak.days} day streak</span>
      {streak.freezeToday ? (
        <span className="text-[var(--color-text-muted)]">Frozen today</span>
      ) : null}
      <span
        className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-72 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[var(--spacing-3)] text-left text-xs font-normal text-[var(--color-text-muted)] shadow-sm group-focus:block group-hover:block"
        role="tooltip"
      >
        {STREAK_TOOLTIP}
      </span>
    </div>
  );
}
