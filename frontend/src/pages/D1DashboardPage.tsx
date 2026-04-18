/**
 * D1 — Dashboard
 * Route: /dashboard   Roles: ANALYST, CFO, ADMIN
 * Only screen that supports Consolidated (ALL) entity view per spec D15.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { DashboardResponse, EntityOrAll } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatISTDate, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Bucket config
// ---------------------------------------------------------------------------

const BUCKET_LABELS: Record<string, string> = {
  NOT_DUE: "Not Due",
  "0_30": "0–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "90_PLUS": "90+ days",
};

const BUCKET_COLORS: Record<string, string> = {
  NOT_DUE: "bg-gray-400",
  "0_30": "bg-green-500",
  "31_60": "bg-yellow-400",
  "61_90": "bg-orange-500",
  "90_PLUS": "bg-red-600",
};

const BUCKET_TEXT: Record<string, string> = {
  NOT_DUE: "text-gray-700",
  "0_30": "text-green-700",
  "31_60": "text-yellow-700",
  "61_90": "text-orange-700",
  "90_PLUS": "text-red-700",
};

function bucketBadge(bucket: string) {
  const labelMap: Record<string, "neutral" | "success" | "warning" | "error"> = {
    NOT_DUE: "neutral",
    "0_30": "success",
    "31_60": "warning",
    "61_90": "warning",
    "90_PLUS": "error",
  };
  return (
    <Badge variant={labelMap[bucket] ?? "neutral"}>{BUCKET_LABELS[bucket] ?? bucket}</Badge>
  );
}

// ---------------------------------------------------------------------------
// Ageing bar chart
// ---------------------------------------------------------------------------

function AgeingBar({
  buckets,
  currency,
}: {
  buckets: Record<string, string>;
  currency: "INR" | "AED";
}) {
  const ORDERED = ["NOT_DUE", "0_30", "31_60", "61_90", "90_PLUS"];
  const values = ORDERED.map((k) => parseFloat(buckets[k] ?? "0"));
  const total = values.reduce((a, b) => a + b, 0);

  if (total === 0) {
    return <p className="text-sm text-slate-400">No data</p>;
  }

  return (
    <div>
      {/* Stacked bar */}
      <div className="flex h-8 w-full overflow-hidden rounded">
        {ORDERED.map((k, i) => {
          const pct = total > 0 ? (values[i] / total) * 100 : 0;
          if (pct < 0.1) return null;
          return (
            <div
              key={k}
              className={cn("relative group", BUCKET_COLORS[k])}
              style={{ width: `${pct}%` }}
              title={`${BUCKET_LABELS[k]}: ${formatCurrency(values[i], currency)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
        {ORDERED.map((k, i) => (
          <div key={k} className="flex flex-col">
            <div className="flex items-center gap-1">
              <div className={cn("h-2.5 w-2.5 rounded-sm", BUCKET_COLORS[k])} />
              <span className="text-xs text-slate-500">{BUCKET_LABELS[k]}</span>
            </div>
            <span className={cn("text-xs font-semibold", BUCKET_TEXT[k])}>
              {formatCurrency(values[i], currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({ data }: { data: DashboardResponse }) {
  const { kpis, currency_display } = data;
  const tiles = [
    {
      label: "Total Outstanding",
      value: formatCurrency(kpis.total_outstanding, currency_display),
      sub: null,
    },
    {
      label: "% Overdue",
      value: formatPct(kpis.pct_overdue),
      sub: null,
    },
    {
      label: "Parties 90+ Days",
      value: kpis.parties_with_90plus_count.toString(),
      sub: null,
    },
    {
      label: "Last Snapshot",
      value: formatISTDate(kpis.last_snapshot_date),
      sub: data.snapshot_status,
    },
    {
      label: kpis.fx_rate_used ? "FX Rate (AED→INR)" : "Currency",
      value: kpis.fx_rate_used ? `₹${parseFloat(kpis.fx_rate_used).toFixed(4)}` : currency_display,
      sub: kpis.fx_rate_used ? "pinned by invoice date" : null,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500">{t.label}</p>
          <p className="mt-0.5 text-xl font-bold text-slate-800 leading-tight">{t.value}</p>
          {t.sub && <p className="mt-0.5 text-xs text-slate-400">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function D1DashboardPage() {
  const { data: user } = useCurrentUser();

  // Entity scope: ANALYST with entity_id_scope can only see their entity
  // For D1 we also support ALL (Consolidated)
  const [entity, setEntity] = useState<EntityOrAll>(() => {
    // If ANALYST has entity scope, lock to that
    return "IND";
  });

  const ENTITY_OPTIONS: { code: EntityOrAll; label: string }[] = [
    { code: "IND", label: "IND" },
    { code: "UAE", label: "UAE" },
    { code: "ALL", label: "Consolidated" },
  ];

  const { data, isLoading, error } = useQuery<DashboardResponse, ApiError>({
    queryKey: ["dashboard", entity],
    queryFn: () => api.get<DashboardResponse>(`/dashboard?entity=${entity}`),
    retry: false,
  });

  const isFxMissing =
    error instanceof ApiError && error.status === 422 &&
    (error.detail as Record<string, string>)?.code === "FX_RATE_MISSING";

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      {/* Header + entity pills */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">AR Dashboard</h1>
        <div className="flex gap-1" role="group" aria-label="Entity">
          {ENTITY_OPTIONS.map((opt) => (
            <button
              key={opt.code}
              onClick={() => setEntity(opt.code)}
              aria-pressed={entity === opt.code}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors",
                entity === opt.code
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-slate-600 hover:bg-gray-200",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* FX missing error */}
      {isFxMissing && (
        <div className="mb-4 rounded border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          <strong>FX rate missing</strong> — Consolidated view requires an AED→INR rate for this
          snapshot period.{" "}
          {user?.role === "ADMIN" && (
            <Link to="/admin/fx-rates" className="underline">
              Add FX rate →
            </Link>
          )}
        </div>
      )}

      {/* Other errors */}
      {error && !isFxMissing && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Failed to load dashboard: {error.message}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* KPIs */}
          <KpiStrip data={data} />

          {/* Ageing bar */}
          <Card>
            <CardHeader>
              <CardTitle>Ageing Breakdown</CardTitle>
              <span className="text-xs text-slate-400">as of {formatISTDate(data.as_of_date)}</span>
            </CardHeader>
            <AgeingBar buckets={data.ageing_buckets} currency={data.currency_display} />
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Top 10 parties */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Parties by Outstanding</CardTitle>
                  {data.parties_on_default_credit_period_count > 0 && (
                    <span className="text-xs text-orange-600">
                      {data.parties_on_default_credit_period_count} on default credit period
                    </span>
                  )}
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="py-1 text-left font-medium">Party</th>
                        <th className="py-1 text-right font-medium">Outstanding</th>
                        <th className="py-1 text-left font-medium">Worst bucket</th>
                        <th className="py-1 text-right font-medium">Exceptions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.top_parties.map((p) => (
                        <tr key={p.canonical_id} className="hover:bg-slate-50">
                          <td className="py-2 pr-3">
                            <Link
                              to={`/party/${p.canonical_id}`}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {p.canonical_name}
                            </Link>
                          </td>
                          <td className="py-2 text-right font-mono text-xs">
                            {formatCurrency(p.outstanding, data.currency_display)}
                          </td>
                          <td className="py-2">{bucketBadge(p.overdue_bucket)}</td>
                          <td className="py-2 text-right">
                            {p.active_exception_count > 0 ? (
                              <Link
                                to={`/exceptions?canonical_id=${p.canonical_id}`}
                                className="text-xs text-orange-600 hover:underline"
                              >
                                {p.active_exception_count} active
                              </Link>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {data.top_parties.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-xs text-slate-400">
                            No data
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Recent exceptions */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Recent Exceptions</CardTitle>
                  <Link to="/exceptions" className="text-xs text-blue-600 hover:underline">
                    All →
                  </Link>
                </CardHeader>
                <div className="space-y-2">
                  {data.recent_exceptions.length === 0 && (
                    <p className="text-xs text-slate-400">No active exceptions</p>
                  )}
                  {data.recent_exceptions.map((ex) => (
                    <div
                      key={ex.exception_id}
                      className="rounded border border-gray-100 bg-slate-50 px-2 py-1.5"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="text-xs font-medium text-slate-700 truncate">
                          {ex.canonical_name}
                        </span>
                        <Badge variant="warning" className="shrink-0">
                          {ex.bucket_type_code}
                        </Badge>
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">{ex.invoice_ref}</p>
                      {ex.expected_resolution_date && (
                        <p className="text-xs text-slate-500">
                          Due: {formatISTDate(ex.expected_resolution_date)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
