"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type BucketDatum = {
  label: string;
  value: number;
  bucket: string;
};

const BUCKET_COLORS: Record<string, string> = {
  "Not Due": "var(--color-accent)",
  "0-30": "var(--color-success)",
  "31-60": "var(--color-warning)",
  "61-90": "var(--color-warning)",
  "90+": "var(--color-danger)",
};

type Props = {
  buckets: BucketDatum[];
};

export function AgeingBucketsChart({ buckets }: Props) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip />
          <Pie
            data={buckets}
            dataKey="value"
            nameKey="label"
            innerRadius={45}
            outerRadius={95}
            paddingAngle={4}
          >
            {buckets.map((bucket) => (
              <Cell
                key={bucket.bucket}
                fill={BUCKET_COLORS[bucket.label] ?? "var(--color-text-subtle)"}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
