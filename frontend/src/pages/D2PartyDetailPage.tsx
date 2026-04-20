/**
 * D2 — Party Drill-Down
 * Route: /party/:canonical_id   Roles: ANALYST, CFO, ADMIN
 */
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { PartyResponse, PartyInvoiceRow } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatISTDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Bucket helpers — shared with D1
// ---------------------------------------------------------------------------

const BUCKET_LABELS: Record<string, string> = {
  NOT_DUE: "Not Due",
  "0_30": "0–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "90_PLUS": "90+ days",
};

type BadgeVariant = "neutral" | "success" | "warning" | "error";

const BUCKET_VARIANT: Record<string, BadgeVariant> = {
  NOT_DUE: "neutral",
  "0_30": "success",
  "31_60": "warning",
  "61_90": "warning",
  "90_PLUS": "error",
};

function bucketBadge(bucket: string | null) {
  if (!bucket) return <span className="text-slate-300">—</span>;
  return (
    <Badge variant={BUCKET_VARIANT[bucket] ?? "neutral"}>
      {BUCKET_LABELS[bucket] ?? bucket}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Sort types
// ---------------------------------------------------------------------------

type SortKey = "invoice_ref" | "invoice_date" | "outstanding_amount" | "bucket" | "overdue_days";
type SortDir = "asc" | "desc";

function sortInvoices(
  rows: PartyInvoiceRow[],
  key: SortKey,
  dir: SortDir,
): PartyInvoiceRow[] {
  return [...rows].sort((a, b) => {
    let av: string | number | null;
    let bv: string | number | null;

    if (key === "outstanding_amount") {
      av = parseFloat(a.outstanding_amount ?? "0");
      bv = parseFloat(b.outstanding_amount ?? "0");
    } else if (key === "overdue_days") {
      av = a.overdue_days ?? -1;
      bv = b.overdue_days ?? -1;
    } else if (key === "bucket") {
      const order = ["90_PLUS", "61_90", "31_60", "0_30", "NOT_DUE"];
      av = order.indexOf(a.bucket ?? "") >= 0 ? order.indexOf(a.bucket ?? "") : 99;
      bv = order.indexOf(b.bucket ?? "") >= 0 ? order.indexOf(b.bucket ?? "") : 99;
    } else if (key === "invoice_date") {
      av = a.invoice_date;
      bv = b.invoice_date;
    } else {
      av = a.invoice_ref;
      bv = b.invoice_ref;
    }

    if (av === null) return 1;
    if (bv === null) return -1;
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Column header with sort indicator
// ---------------------------------------------------------------------------

function SortTh({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === current;
  return (
    <th
      className={cn(
        "cursor-pointer select-none py-2 text-xs font-medium text-slate-500 hover:text-slate-800",
        className,
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : " ↕"}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function D2PartyDetailPage() {
  const { canonical_id } = useParams<{ canonical_id: string }>();

  const [sortKey, setSortKey] = useState<SortKey>("outstanding_amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data, isLoading, error } = useQuery<PartyResponse, ApiError>({
    queryKey: ["party", canonical_id],
    queryFn: () => api.get<PartyResponse>(`/parties/${canonical_id}`),
    enabled: !!canonical_id,
    retry: false,
  });

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "outstanding_amount" || key === "overdue_days" ? "desc" : "asc");
    }
  }

  const is404 =
    error instanceof ApiError && (error.status === 404 || error.status === 422);

  const currency = (data?.currency_display ?? "INR") as "INR" | "AED";

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      {/* Back link */}
      <Link
        to="/dashboard"
        className="mb-4 inline-block text-sm text-blue-600 hover:underline"
      >
        ← Back to Dashboard
      </Link>

      {/* Loading */}
      {isLoading && <PageSkeleton />}

      {/* 404 */}
      {is404 && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-red-700">Party not found</p>
          <p className="mt-1 text-xs text-red-500 font-mono">{canonical_id}</p>
        </div>
      )}

      {/* Generic error */}
      {error && !is404 && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load party: {error.message}
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-800">{data.canonical_name}</h1>
              <Badge variant="muted" className="mt-1">{data.entity_code}</Badge>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">Total Outstanding</p>
              <p className="mt-0.5 text-xl font-bold text-slate-800 leading-tight">
                {formatCurrency(data.total_outstanding, currency)}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">Open Invoices</p>
              <p className="mt-0.5 text-xl font-bold text-slate-800 leading-tight">
                {data.active_invoice_count}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">Active Exceptions</p>
              <p
                className={cn(
                  "mt-0.5 text-xl font-bold leading-tight",
                  data.active_exception_count > 0 ? "text-orange-600" : "text-slate-800",
                )}
              >
                {data.active_exception_count}
              </p>
            </div>
          </div>

          {/* Invoices table */}
          <Card>
            <CardHeader>
              <CardTitle>Invoices ({data.invoices.length})</CardTitle>
            </CardHeader>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-slate-400">No invoices found for this party.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 border-b border-gray-100">
                    <tr>
                      <SortTh
                        label="Invoice Ref"
                        sortKey="invoice_ref"
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        className="text-left pr-3"
                      />
                      <SortTh
                        label="Date"
                        sortKey="invoice_date"
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        className="text-left pr-3"
                      />
                      <th className="py-2 text-right text-xs font-medium text-slate-500 pr-3">Amount</th>
                      <SortTh
                        label="Outstanding"
                        sortKey="outstanding_amount"
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        className="text-right pr-3"
                      />
                      <SortTh
                        label="Bucket"
                        sortKey="bucket"
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        className="text-left pr-3"
                      />
                      <SortTh
                        label="Overdue Days"
                        sortKey="overdue_days"
                        current={sortKey}
                        dir={sortDir}
                        onSort={handleSort}
                        className="text-right pr-3"
                      />
                      <th className="py-2 text-right text-xs font-medium text-slate-500">Exceptions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortInvoices(data.invoices, sortKey, sortDir).map((inv) => (
                      <tr key={inv.invoice_id} className="hover:bg-slate-50">
                        <td className="py-2 pr-3">
                          <Link
                            to={`/invoice/${inv.invoice_id}`}
                            className="font-medium text-blue-700 hover:underline font-mono text-xs"
                          >
                            {inv.invoice_ref}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-600">
                          {formatISTDate(inv.invoice_date)}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-xs text-slate-600">
                          {formatCurrency(inv.amount, inv.currency as "INR" | "AED")}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-xs font-semibold text-slate-800">
                          {inv.outstanding_amount
                            ? formatCurrency(inv.outstanding_amount, currency)
                            : "—"}
                        </td>
                        <td className="py-2 pr-3">{bucketBadge(inv.bucket)}</td>
                        <td className="py-2 pr-3 text-right text-xs text-slate-600">
                          {inv.overdue_days != null ? inv.overdue_days : "—"}
                        </td>
                        <td className="py-2 text-right">
                          {inv.active_exception_count > 0 ? (
                            <span className="text-xs text-orange-600 font-medium">
                              {inv.active_exception_count}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
