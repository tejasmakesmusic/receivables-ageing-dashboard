/**
 * D3 — Invoice Drill-Down
 * Route: /invoice/:invoice_id   Roles: ANALYST, CFO, ADMIN
 */
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { InvoiceDetailResponse } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatISTDate, formatISTDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Bucket helpers — mirrors D1/D2
// ---------------------------------------------------------------------------

const BUCKET_LABELS: Record<string, string> = {
  NOT_DUE: "Not Due",
  "0_30": "0–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  "90_PLUS": "90+ days",
};

type BadgeVariant = "neutral" | "success" | "warning" | "error" | "info";

const BUCKET_VARIANT: Record<string, BadgeVariant> = {
  NOT_DUE: "neutral",
  "0_30": "success",
  "31_60": "warning",
  "61_90": "warning",
  "90_PLUS": "error",
};

function bucketBadge(bucket: string) {
  return (
    <Badge variant={BUCKET_VARIANT[bucket] ?? "neutral"}>
      {BUCKET_LABELS[bucket] ?? bucket}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Credit period source badge
// ---------------------------------------------------------------------------

const CREDIT_SOURCE_VARIANT: Record<string, BadgeVariant> = {
  CONFIG: "info",
  DEFAULT: "neutral",
  MANUAL: "warning",
};

function creditSourceBadge(source: string) {
  return (
    <Badge variant={CREDIT_SOURCE_VARIANT[source] ?? "neutral"}>{source}</Badge>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  const v: BadgeVariant =
    status === "SETTLED" ? "success" : status === "ACTIVE" ? "info" : "neutral";
  return <Badge variant={v}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header detail row helper
// ---------------------------------------------------------------------------

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="text-xs text-slate-500 w-36 shrink-0">{label}</span>
      <span className="text-sm text-slate-800">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function D3InvoiceDetailPage() {
  const { invoice_id } = useParams<{ invoice_id: string }>();

  const { data, isLoading, error } = useQuery<InvoiceDetailResponse, ApiError>({
    queryKey: ["invoice", invoice_id],
    queryFn: () => api.get<InvoiceDetailResponse>(`/invoices/${invoice_id}`),
    enabled: !!invoice_id,
    retry: false,
  });

  const is404 =
    error instanceof ApiError && (error.status === 404 || error.status === 422);

  const currency = (data?.currency ?? "INR") as "INR" | "AED";

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      {/* Back links */}
      <div className="mb-4 flex items-center gap-3">
        <Link to="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
        </Link>
        {data && (
          <>
            <span className="text-slate-300">/</span>
            <Link
              to={`/party/${data.canonical_id}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {data.canonical_name}
            </Link>
          </>
        )}
      </div>

      {/* Loading */}
      {isLoading && <PageSkeleton />}

      {/* 404 */}
      {is404 && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-red-700">Invoice not found</p>
          <p className="mt-1 text-xs text-red-500 font-mono">{invoice_id}</p>
        </div>
      )}

      {/* Generic error */}
      {error && !is404 && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load invoice: {error.message}
        </div>
      )}

      {data && (
        <div className="space-y-5">
          {/* Invoice header card */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  <p className="text-xs text-slate-500 font-mono mb-0.5">Invoice</p>
                  <h1 className="text-xl font-bold text-slate-800 font-mono">
                    {data.invoice_ref}
                  </h1>
                </div>
                <div className="flex flex-wrap gap-2 mt-1">
                  {statusBadge(data.status)}
                  <Badge variant="muted">{data.entity_code}</Badge>
                </div>
              </div>
            </CardHeader>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DetailRow label="Party">
                <Link
                  to={`/party/${data.canonical_id}`}
                  className="text-blue-700 hover:underline"
                >
                  {data.canonical_name}
                </Link>
              </DetailRow>
              <DetailRow label="Amount">
                <span className="font-semibold">
                  {formatCurrency(data.amount, currency)}
                </span>
                <span className="ml-1 text-xs text-slate-400">{data.currency}</span>
              </DetailRow>
              <DetailRow label="Invoice Date">
                {formatISTDate(data.invoice_date)}
              </DetailRow>
              <DetailRow label="Due Date">
                {formatISTDate(data.due_date)}
              </DetailRow>
              <DetailRow label="Credit Days">
                <span className="mr-1">{data.credit_days_applied}</span>
                {creditSourceBadge(data.credit_days_source)}
              </DetailRow>
              <DetailRow label="Currency">{data.currency}</DetailRow>
            </div>
          </Card>

          {/* Exception Tags */}
          <Card>
            <CardHeader>
              <CardTitle>Exception Tags</CardTitle>
              {data.exception_tags.length > 0 && (
                <span className="text-xs text-orange-600">
                  {data.exception_tags.filter((t) => t.status === "OPEN").length} active
                </span>
              )}
            </CardHeader>

            {data.exception_tags.length === 0 ? (
              <p className="text-sm text-slate-400">No exception tags on this invoice.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 border-b border-gray-100">
                    <tr>
                      <th className="py-2 text-left font-medium pr-3">Bucket</th>
                      <th className="py-2 text-left font-medium pr-3">Reason</th>
                      <th className="py-2 text-left font-medium pr-3">Tagged By</th>
                      <th className="py-2 text-left font-medium pr-3">Tagged At</th>
                      <th className="py-2 text-left font-medium pr-3">Expected Resolution</th>
                      <th className="py-2 text-left font-medium pr-3">Status</th>
                      <th className="py-2 text-left font-medium text-slate-300">Resolve</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.exception_tags.map((tag) => (
                      <tr key={tag.id} className={cn("hover:bg-slate-50", tag.status !== "OPEN" && "opacity-50")}>
                        <td className="py-2 pr-3">
                          <Badge variant="warning">{tag.bucket_type_code}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-700 max-w-xs">
                          {tag.reason}
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-500">
                          {tag.tagged_by_email}
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                          {formatISTDateTime(tag.tagged_at)}
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-500">
                          {tag.expected_resolution_date
                            ? formatISTDate(tag.expected_resolution_date)
                            : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          {tag.status === "OPEN" ? (
                            <Badge variant="info">Open</Badge>
                          ) : tag.status === "RESOLVED" ? (
                            <Badge variant="success">Resolved</Badge>
                          ) : (
                            <Badge variant="neutral">{tag.status}</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <button
                            disabled
                            title="Resolve action is out of scope for this release"
                            className="rounded px-2 py-0.5 text-xs text-slate-400 border border-slate-200 cursor-not-allowed"
                          >
                            Resolve
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Snapshot History */}
          <Card>
            <CardHeader>
              <CardTitle>Snapshot History</CardTitle>
              <span className="text-xs text-slate-400">newest first</span>
            </CardHeader>

            {data.snapshot_history.length === 0 ? (
              <p className="text-sm text-slate-400">No snapshot history available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500 border-b border-gray-100">
                    <tr>
                      <th className="py-2 text-left font-medium pr-3">As Of Date</th>
                      <th className="py-2 text-right font-medium pr-3">Outstanding</th>
                      <th className="py-2 text-right font-medium pr-3">Overdue Days</th>
                      <th className="py-2 text-left font-medium">Bucket</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...data.snapshot_history]
                      .sort((a, b) => (a.as_of_date > b.as_of_date ? -1 : 1))
                      .map((row) => (
                        <tr key={row.snapshot_id} className="hover:bg-slate-50">
                          <td className="py-2 pr-3 text-xs text-slate-600 whitespace-nowrap">
                            {formatISTDate(row.as_of_date)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-xs font-semibold text-slate-800">
                            {formatCurrency(row.outstanding_amount, currency)}
                          </td>
                          <td className="py-2 pr-3 text-right text-xs text-slate-600">
                            {row.overdue_days}
                          </td>
                          <td className="py-2">{bucketBadge(row.bucket)}</td>
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
