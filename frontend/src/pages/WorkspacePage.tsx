/**
 * WorkspacePage — /snapshots
 * Browse all uploaded snapshots with filter bar, status, and quick-actions.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { SnapshotListResponse, SnapshotListRow } from "@/types";
import { formatISTDateTime, formatINR } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

type StatusFilter = "" | "STAGED" | "PUBLISHED" | "DISCARDED" | "PARSE_ERROR";
type SourceFilter = "" | "TALLY" | "XERO" | "CREDIT_PERIOD";
type EntityFilter = "" | "IND" | "UAE";

function statusVariant(s: string): "success" | "warning" | "error" | "neutral" | "info" {
  if (s === "PUBLISHED") return "success";
  if (s === "STAGED") return "warning";
  if (s === "DISCARDED") return "neutral";
  if (s === "PARSE_ERROR") return "error";
  return "info";
}

export function WorkspacePage() {
  const [entity, setEntity] = useState<EntityFilter>("");
  const [source, setSource] = useState<SourceFilter>("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const params = new URLSearchParams();
  if (entity) params.set("entity", entity);
  if (source) params.set("source_hint", source);
  if (status) params.set("status", status);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));

  const { data, isLoading, error } = useQuery<SnapshotListResponse, ApiError>({
    queryKey: ["workspace-snapshots", entity, source, status, page],
    queryFn: () => api.get<SnapshotListResponse>(`/snapshots?${params.toString()}`),
    retry: false,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Workspace</h1>
        <Link to="/upload">
          <Button variant="primary" size="sm">+ Upload snapshot</Button>
        </Link>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          aria-label="Entity"
          value={entity}
          onChange={(e) => { setEntity(e.target.value as EntityFilter); setPage(1); }}
          className="rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All entities</option>
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </select>
        <select
          aria-label="Source"
          value={source}
          onChange={(e) => { setSource(e.target.value as SourceFilter); setPage(1); }}
          className="rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All sources</option>
          <option value="TALLY">Tally</option>
          <option value="XERO">Xero</option>
          <option value="CREDIT_PERIOD">Credit Period</option>
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1); }}
          className="rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          <option value="STAGED">Staged</option>
          <option value="PUBLISHED">Published</option>
          <option value="DISCARDED">Discarded</option>
          <option value="PARSE_ERROR">Parse Error</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Failed to load snapshots: {error.message}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">As-of date</th>
              <th className="px-3 py-2 text-left font-medium">Entity</th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Rows</th>
              <th className="px-3 py-2 text-right font-medium">Outstanding</th>
              <th className="px-3 py-2 text-left font-medium">Uploaded by</th>
              <th className="px-3 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : (data?.items ?? []).map((row) => (
                  <SnapshotRow key={row.id} row={row} />
                ))}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                  No snapshots match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{data.total} total</span>
          <div className="flex gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Prev
            </Button>
            <span className="flex items-center px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SnapshotRow({ row }: { row: SnapshotListRow }) {
  const isCp = row.source_hint === "CREDIT_PERIOD";
  const isStaged = row.status === "STAGED";

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2 font-mono text-xs">
        {row.as_of_date ?? <span className="text-slate-400">—</span>}
      </td>
      <td className="px-3 py-2">
        <Badge variant="neutral">{row.entity_code}</Badge>
      </td>
      <td className="px-3 py-2 text-xs text-slate-600">{row.source_hint}</td>
      <td className="px-3 py-2">
        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs">
        {row.row_count != null ? row.row_count.toLocaleString() : "—"}
      </td>
      <td className="px-3 py-2 text-right text-xs">
        {row.total_outstanding ? formatINR(row.total_outstanding) : "—"}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">
        {row.uploaded_by_email ?? "—"}
      </td>
      <td className="px-3 py-2 text-xs text-slate-400">
        {formatISTDateTime(row.uploaded_at)}
      </td>
      <td className="px-3 py-2">
        {isStaged && isCp ? (
          <Link
            to={`/snapshots/${row.id}/staging`}
            className="text-xs text-blue-600 hover:underline"
          >
            View config diff
          </Link>
        ) : isStaged ? (
          <Link
            to={`/staging/${row.id}`}
            className="text-xs text-blue-600 hover:underline"
          >
            Review →
          </Link>
        ) : row.status === "PUBLISHED" ? (
          <Link
            to={`/snapshots/${row.id}/invoices`}
            className="text-xs text-slate-500 hover:underline"
          >
            View invoices
          </Link>
        ) : null}
      </td>
    </tr>
  );
}
