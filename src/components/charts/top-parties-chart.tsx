"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Datum = {
  canonical_id: string;
  name: string;
  outstanding: number;
  bucket: string;
};

const BUCKET_COLOR: Record<string, string> = {
  NOT_DUE: "var(--color-accent)",
  DUE_TODAY: "var(--color-warning)",
  "0_30": "var(--color-success)",
  "31_60": "var(--color-warning)",
  "61_90": "var(--color-warning)",
  "90_PLUS": "var(--color-danger)",
};

function compactCurrency(value: number): string {
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `${(value / 100_000).toFixed(1)}L`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toString();
}

/**
 * PR 4 — horizontal bar chart of the top N debtors by outstanding amount.
 * Each bar coloured by its overdue bucket so the eye picks up risk
 * concentration immediately.
 */
export function TopPartiesChart({ data }: { data: Datum[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No outstanding parties.
      </p>
    );
  }

  const height = Math.max(180, data.length * 36);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
        >
          <CartesianGrid stroke="var(--color-border)" horizontal={false} />
          <XAxis
            type="number"
            tickFormatter={compactCurrency}
            stroke="var(--color-text-muted)"
            fontSize={11}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            stroke="var(--color-text-muted)"
            fontSize={11}
            tick={{ fill: "var(--color-text)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--color-bg-muted)" }}
            formatter={(v: number) => [compactCurrency(v), "Outstanding"]}
          />
          <Bar dataKey="outstanding" radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell
                key={d.canonical_id}
                fill={BUCKET_COLOR[d.bucket] ?? "var(--color-accent)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
