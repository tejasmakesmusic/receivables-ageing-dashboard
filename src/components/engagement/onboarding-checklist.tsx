"use client";

import Link from "next/link";
import { useState } from "react";

export const ONBOARDING_DISMISSED_KEY =
  "receivables_onboarding_dismissed_v1";

export type OnboardingChecklistProps = {
  completion: {
    uploaded_snapshot: boolean;
    resolved_warnings: boolean;
    worked_task: boolean;
    logged_follow_up: boolean;
    recorded_ptp: boolean;
    raised_dispute: boolean;
    reviewed_export: boolean;
  };
};

type CompletionKey = keyof OnboardingChecklistProps["completion"];

const STEPS: Array<{
  key: CompletionKey;
  label: string;
  href: string;
}> = [
  {
    key: "uploaded_snapshot",
    label: "Upload your first AR snapshot",
    href: "/upload",
  },
  {
    key: "resolved_warnings",
    label: "Resolve any staging warnings",
    href: "/snapshots",
  },
  {
    key: "worked_task",
    label: "Work a collection task",
    href: "/tasks",
  },
  {
    key: "logged_follow_up",
    label: "Log a follow-up",
    href: "/follow-ups",
  },
  {
    key: "recorded_ptp",
    label: "Record a promise to pay",
    href: "/promises-to-pay",
  },
  {
    key: "raised_dispute",
    label: "Raise a dispute (if applicable)",
    href: "/dispute-cases",
  },
  {
    key: "reviewed_export",
    label: "Review the ageing export",
    href: "/reports",
  },
];

function nextOpenStep(completion: OnboardingChecklistProps["completion"]) {
  return STEPS.find((step) => !completion[step.key]);
}

function readDismissedPreference() {
  if (typeof window === "undefined") return false;

  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function OnboardingChecklist({ completion }: OnboardingChecklistProps) {
  const [isDismissed, setIsDismissed] = useState(readDismissedPreference);
  const [isOpen, setIsOpen] = useState(true);
  const completedCount = STEPS.filter((step) => completion[step.key]).length;
  const allComplete = completedCount === STEPS.length;
  const nextStep = nextOpenStep(completion);

  if (isDismissed) {
    return null;
  }

  function dismissChecklist() {
    try {
      localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true");
    } catch {
      // Storage may be unavailable in hardened browser profiles.
    }
    setIsDismissed(true);
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--spacing-3)] border-b border-[var(--color-border)] px-[var(--spacing-4)] py-[var(--spacing-3)]">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            First-run checklist
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {allComplete
              ? "All first-run checklist steps are complete."
              : nextStep?.key === "uploaded_snapshot"
                ? "You haven't uploaded a snapshot yet - it starts every weekly cycle."
                : `${completedCount} of ${STEPS.length} steps complete.`}
          </p>
        </div>
        <div className="flex items-center gap-[var(--spacing-2)]">
          <button
            aria-expanded={isOpen}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--spacing-3)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
            onClick={() => setIsOpen((value) => !value)}
            type="button"
          >
            {isOpen ? "Collapse" : "Expand"}
          </button>
          <button
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--spacing-3)] text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)]"
            onClick={dismissChecklist}
            type="button"
          >
            Dismiss checklist
          </button>
        </div>
      </div>

      {isOpen ? (
        allComplete ? (
          <p className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-sm text-[var(--color-text-muted)]">
            The setup path is complete for this browser profile.
          </p>
        ) : (
          <ol className="divide-y divide-[var(--color-border)]">
            {STEPS.map((step) => {
              const done = completion[step.key];

              return (
                <li
                  className="flex items-center gap-[var(--spacing-3)] px-[var(--spacing-4)] py-[var(--spacing-2)] text-sm"
                  key={step.key}
                >
                  <input
                    aria-label={`${step.label}: ${done ? "complete" : "pending"}`}
                    checked={done}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    readOnly
                    type="checkbox"
                  />
                  <Link
                    className="flex-1 text-[var(--color-text)] hover:text-[var(--color-accent)] hover:underline"
                    href={step.href}
                  >
                    {step.label}
                  </Link>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {done ? "Complete" : "Open"}
                  </span>
                </li>
              );
            })}
          </ol>
        )
      ) : null}
    </section>
  );
}
