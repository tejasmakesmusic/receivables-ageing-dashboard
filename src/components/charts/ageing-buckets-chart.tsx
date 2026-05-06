"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type BucketDatum = {
  label: string;
  value: number;
  bucket: string;
};

const BUCKET_COLORS: Record<string, string> = {
  "Not Due": "#0ea5e9",
  "0-30": "#22c55e",
  "31-60": "#f59e0b",
  "61-90": "#f97316",
  "90+": "#ef4444",
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
                fill={BUCKET_COLORS[bucket.label] ?? "#64748b"}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
