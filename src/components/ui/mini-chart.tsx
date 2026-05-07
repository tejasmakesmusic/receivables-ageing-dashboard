export function MiniSparkline({
  color = "var(--color-accent)",
}: {
  color?: string;
}) {
  return (
    <svg aria-hidden="true" className="h-9 w-24" viewBox="0 0 96 36">
      <path
        d="M2 30 C14 26 14 17 26 19 C39 22 37 8 50 11 C61 14 60 6 72 8 C82 10 83 5 94 6"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const bounded = Math.max(0, Math.min(100, value));

  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
      <div
        className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150"
        style={{ width: `${bounded}%` }}
      />
    </div>
  );
}
