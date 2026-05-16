/**
 * MiniSparkline — renders a small line chart from a numeric series.
 *
 * Audit 2026-05-16: the previous prop-less version drew a fixed rising
 * curve regardless of data, which misled users into reading it as a real
 * trend. The component now requires `values`; with fewer than 2 points
 * it renders a flat baseline so the affordance still occupies the same
 * grid space without implying a trend.
 */
export function MiniSparkline({
  values,
  color = "var(--color-accent)",
}: {
  values?: number[];
  color?: string;
}) {
  const width = 96;
  const height = 36;
  const padding = 3;

  if (!values || values.length < 2) {
    return (
      <svg aria-hidden="true" className="h-9 w-24" viewBox={`0 0 ${width} ${height}`}>
        <line
          stroke="var(--color-border)"
          strokeDasharray="2 3"
          strokeWidth="1"
          x1={padding}
          x2={width - padding}
          y1={height / 2}
          y2={height / 2}
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - 2 * padding) / (values.length - 1);
  const d = values
    .map((v, i) => {
      const x = padding + i * step;
      const y = height - padding - ((v - min) / range) * (height - 2 * padding);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg aria-hidden="true" className="h-9 w-24" viewBox={`0 0 ${width} ${height}`}>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
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
