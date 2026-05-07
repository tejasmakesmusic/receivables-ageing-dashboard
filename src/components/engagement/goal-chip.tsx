"use client";

export type GoalChipProps = {
  target: number;
  completed: number;
  label?: string;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function GoalChip({
  target = 10,
  completed,
  label = "Today's focus",
}: GoalChipProps) {
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 10;
  const safeCompleted = Math.max(0, Math.floor(completed));
  const rawPercent = (safeCompleted / safeTarget) * 100;
  const percent = clampPercent(rawPercent);
  const metGoal = safeCompleted >= safeTarget;
  const overTarget = safeCompleted > safeTarget;
  const statusCopy = metGoal
    ? overTarget
      ? "Above target"
      : "Goal met today"
    : `${safeCompleted} of ${safeTarget}`;
  const fillClass =
    percent === 0
      ? "bg-[var(--color-bg-muted)]"
      : metGoal
        ? "bg-[var(--color-success)]"
        : "bg-[var(--color-accent)]";
  const shellClass = metGoal
    ? "border-[var(--color-success)] bg-[var(--color-success-soft)]"
    : "border-[var(--color-border)] bg-[var(--color-surface)]";

  return (
    <div
      aria-label={`${label}: ${safeCompleted} of ${safeTarget}`}
      aria-valuemax={safeTarget}
      aria-valuemin={0}
      aria-valuenow={Math.min(safeCompleted, safeTarget)}
      className={[
        "relative h-8 min-w-[220px] overflow-hidden rounded-[var(--radius-pill)] border px-[var(--spacing-3)]",
        shellClass,
      ].join(" ")}
      role="progressbar"
    >
      <div
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 ${fillClass} opacity-15`}
        style={{ width: `${percent}%` }}
      />
      <div className="relative z-10 flex h-full items-center justify-between gap-[var(--spacing-3)] text-xs">
        <span className="font-medium text-[var(--color-text)]">{label}</span>
        <span
          className={
            metGoal
              ? "font-semibold text-[var(--color-success)]"
              : "font-medium text-[var(--color-text-muted)]"
          }
        >
          {statusCopy}
        </span>
      </div>
    </div>
  );
}
