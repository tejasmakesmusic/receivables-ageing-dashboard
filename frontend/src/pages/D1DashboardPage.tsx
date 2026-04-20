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
import type { DashboardResponse, DashboardTrendRow, EntityOrAll } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatISTDate, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FX tooltip helper (spec §7)
// ---------------------------------------------------------------------------

/**
 * Build the tooltip copy used on every converted INR figure in the
 * consolidated (entity=ALL) view.  Returns undefined when the rate is absent
 * so callers can omit the title attribute entirely.
 */
function fxTooltip(kpis: import("@/types").DashboardKPIs): string | undefined {
  if (
    !kpis.fx_rate_used ||
    !kpis.fx_rate_effective_from ||
    !kpis.fx_rate_from_ccy ||
    !kpis.fx_rate_to_ccy
  ) {
    return undefined;
  }
  const rate = parseFloat(kpis.fx_rate_used).toFixed(4);
  return `Converted at ${kpis.fx_rate_from_ccy}→${kpis.fx_rate_to_ccy} ${rate} effective from ${kpis.fx_rate_effective_from}`;
}

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
// Trend sparkline (inline SVG, no external chart lib)
// ---------------------------------------------------------------------------

function TrendSparkline({ data }: { data: DashboardTrendRow[] }) {
  if (data.length === 0) {
    return (
      <p className="text-xs text-slate-400 py-8 text-center">No trend data yet</p>
    );
  }

  const W = 300;
  const H = 100;
  const PAD_L = 4;
  const PAD_R = 4;
  const PAD_T = 8;
  const PAD_B = 18; // room for x-axis labels

  const totals = data.map((d) => parseFloat(d.total_outstanding));
  const ninetyPlus = data.map((d) => parseFloat(d.ninety_plus));
  const allValues = [...totals, ...ninetyPlus];
  const maxVal = Math.max(...allValues, 1);
  const minVal = 0;

  const xStep = data.length > 1 ? (W - PAD_L - PAD_R) / (data.length - 1) : 0;
  const yRange = H - PAD_T - PAD_B;

  function toPoint(value: number, idx: number): string {
    const x = PAD_L + idx * xStep;
    const y = PAD_T + yRange - ((value - minVal) / (maxVal - minVal)) * yRange;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }

  const totalPoints = totals.map((v, i) => toPoint(v, i)).join(" ");
  const ninetyPoints = ninetyPlus.map((v, i) => toPoint(v, i)).join(" ");

  // x-axis: show first, middle (if ≥4 pts), and last week labels
  const labelIndices: number[] = [0];
  if (data.length >= 4) labelIndices.push(Math.floor(data.length / 2));
  if (data.length > 1) labelIndices.push(data.length - 1);
  // deduplicate
  const uniqueIndices = [...new Set(labelIndices)];

  function shortDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }

  return (
    <div data-testid="trend-sparkline">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "100px" }}
        aria-label="8-week AR trend sparkline"
      >
        {/* Light grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const y = PAD_T + yRange * (1 - frac);
          return (
            <line
              key={frac}
              x1={PAD_L}
              y1={y.toFixed(1)}
              x2={W - PAD_R}
              y2={y.toFixed(1)}
              stroke="#f3f4f6"
              strokeWidth="1"
            />
          );
        })}

        {/* Total AR polyline — indigo/slate-700 per task spec */}
        {data.length > 1 && (
          <polyline
            points={totalPoints}
            fill="none"
            stroke="#334155"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        )}
        {data.length === 1 && (
          <circle
            cx={PAD_L}
            cy={(PAD_T + yRange / 2).toFixed(1)}
            r="3"
            fill="#334155"
          />
        )}

        {/* 90+ overlay polyline — red-500 dashed */}
        {data.length > 1 && (
          <polyline
            points={ninetyPoints}
            fill="none"
            stroke="#ef4444"
            strokeWidth="1.5"
            strokeDasharray="4,2"
            strokeLinejoin="round"
          />
        )}
        {data.length === 1 && (
          <circle
            cx={PAD_L}
            cy={(PAD_T + yRange / 2).toFixed(1)}
            r="2"
            fill="#ef4444"
          />
        )}

        {/* X-axis labels */}
        {uniqueIndices.map((idx) => {
          const x = PAD_L + idx * xStep;
          return (
            <text
              key={idx}
              x={x.toFixed(1)}
              y={H - 2}
              fontSize="7"
              fill="#9ca3af"
              textAnchor={idx === 0 ? "start" : idx === data.length - 1 ? "end" : "middle"}
            >
              {shortDate(data[idx].week_start)}
            </text>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex gap-4 text-xs mt-1">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-slate-700 rounded" />
          <span className="text-slate-500">Total AR</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-4 h-0.5 bg-red-500 rounded"
            style={{ backgroundImage: "repeating-linear-gradient(to right, #ef4444 0 4px, transparent 4px 6px)" }}
          />
          <span className="text-slate-500">90+ bucket</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ageing bar chart
// ---------------------------------------------------------------------------

function AgeingBar({
  buckets,
  currency,
  fxTooltipText,
}: {
  buckets: Record<string, string>;
  currency: "INR" | "AED";
  fxTooltipText?: string;
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
            <span
              className={cn("text-xs font-semibold", BUCKET_TEXT[k])}
              title={fxTooltipText}
              data-testid={fxTooltipText ? `ageing-bucket-${k}` : undefined}
            >
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
  const tooltip = fxTooltip(kpis);

  const tiles = [
    {
      label: "Total Outstanding",
      value: formatCurrency(kpis.total_outstanding, currency_display),
      sub: null,
      tooltip,
    },
    {
      label: "% Overdue",
      value: formatPct(kpis.pct_overdue),
      sub: null,
      tooltip: undefined,
    },
    {
      label: "Parties 90+ Days",
      value: kpis.parties_with_90plus_count.toString(),
      sub: null,
      tooltip: undefined,
    },
    {
      label: "Last Snapshot",
      value: formatISTDate(kpis.last_snapshot_date),
      sub: data.snapshot_status,
      tooltip: undefined,
    },
    {
      label: kpis.fx_rate_used ? "FX Rate (AED→INR)" : "Currency",
      value: kpis.fx_rate_used ? `₹${parseFloat(kpis.fx_rate_used).toFixed(4)}` : currency_display,
      sub: kpis.fx_rate_used ? "pinned by invoice date" : null,
      tooltip: undefined,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500">{t.label}</p>
          <p
            className="mt-0.5 text-xl font-bold text-slate-800 leading-tight"
            title={t.tooltip}
            data-testid={t.label === "Total Outstanding" ? "kpi-total-outstanding" : undefined}
          >
            {t.value}
          </p>
          {t.sub && <p className="mt-0.5 text-xs text-slate-400">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tally / Our overdue days cell (spec §13 #4)
// ---------------------------------------------------------------------------

function TallyOverdueCell({ party }: { party: import("@/types").TopPartyRow }) {
  // overdue_bucket encodes our worst bucket; we need a single "our" figure —
  // but the backend only exposes bucket label at top-party level, not an exact
  // day count.  The tooltip is trust-critical: show Tally's raw figure when
  // present; omit the Tally half when null (Xero/no raw data).
  if (party.tally_overdue_days_max === null || party.tally_overdue_days_max === undefined) {
    return <span className="text-slate-300">—</span>;
  }
  return (
    <span
      className="cursor-help"
      title="Our calc uses EMB credit period master. Tally's figure may differ due to its own due_on logic (spec §13 #4)."
      data-testid="tally-overdue-cell"
    >
      <span className="text-slate-500">Tally: {party.tally_overdue_days_max}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Default credit period banner
// ---------------------------------------------------------------------------

function DefaultCreditPeriodBanner({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-xl text-amber-500" aria-hidden="true">ℹ</span>
        <div>
          <p className="text-sm font-medium text-amber-800">
            {count} {count === 1 ? "party" : "parties"} using entity default credit period
          </p>
          <p className="mt-0.5 text-xs text-amber-600">
            These parties have no party-specific credit config. Review and add specific terms where applicable.
          </p>
        </div>
      </div>
      <Link to="/credit-period" className="flex-shrink-0">
        <Button
          variant="secondary"
          size="sm"
          className="border-amber-300 bg-amber-100 text-amber-700 hover:bg-amber-200"
        >
          Review credit config →
        </Button>
      </Link>
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
            <AgeingBar
              buckets={data.ageing_buckets}
              currency={data.currency_display}
              fxTooltipText={fxTooltip(data.kpis)}
            />
          </Card>

          {/* Default credit period call-out */}
          <DefaultCreditPeriodBanner count={data.parties_on_default_credit_period_count} />

          {/* Trend sparkline */}
          {data.trend_weekly !== undefined && (
            <Card>
              <CardHeader>
                <CardTitle>8-week AR Trend</CardTitle>
                <span className="text-xs text-slate-400">{entity} · total vs 90+</span>
              </CardHeader>
              <TrendSparkline data={data.trend_weekly} />
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Top 10 parties */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Parties by Outstanding</CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500">
                      <tr>
                        <th className="py-1 text-left font-medium">Party</th>
                        <th className="py-1 text-right font-medium">Outstanding</th>
                        <th className="py-1 text-left font-medium">Worst bucket</th>
                        <th className="py-1 text-right font-medium">Exceptions</th>
                        <th className="py-1 text-left font-medium">
                          Overdue days
                          <span
                            className="ml-1 cursor-help text-slate-400"
                            title="Tally / Our — Tally's own overdue_days vs EMB's computed figure (spec §13 #4)"
                          >
                            ℹ
                          </span>
                        </th>
                        <th className="py-1 text-left font-medium">Last follow-up</th>
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
                            <span title={fxTooltip(data.kpis)} data-testid={fxTooltip(data.kpis) ? `party-outstanding-${p.canonical_id}` : undefined}>
                              {formatCurrency(p.outstanding, data.currency_display)}
                            </span>
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
                          <td className="py-2 text-xs text-slate-500">
                            <TallyOverdueCell party={p} />
                          </td>
                          <td className="py-2 text-xs text-slate-500" data-testid={`last-fu-${p.canonical_id}`}>
                            {p.last_follow_up_date ? (
                              <span className="flex items-center gap-1">
                                {formatISTDate(p.last_follow_up_date)}
                                <Badge variant="muted">{p.last_follow_up_channel}</Badge>
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {data.top_parties.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-xs text-slate-400">
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
