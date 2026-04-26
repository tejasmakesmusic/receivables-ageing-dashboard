/**
 * SnapshotInvoicesPage — /snapshots/:id/invoices
 * Shows metadata header for a snapshot and a summary of its invoice contents.
 */
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { SnapshotDetailResponse } from "@/types";
import { formatISTDate, formatISTDateTime, formatINR } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";

function statusVariant(s: string): "success" | "warning" | "error" | "neutral" | "info" {
  if (s === "PUBLISHED") return "success";
  if (s === "STAGED") return "warning";
  if (s === "DISCARDED") return "neutral";
  if (s === "PARSE_ERROR") return "error";
  return "info";
}

export function SnapshotInvoicesPage() {
  const { id } = useParams<{ id: string }>();

  const { data: snap, isLoading, error } = useQuery<SnapshotDetailResponse, ApiError>({
    queryKey: ["snapshot-detail", id],
    queryFn: () => api.get<SnapshotDetailResponse>(`/snapshots/${id}`),
    retry: false,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-6 space-y-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !snap) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-6">
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error?.message ?? "Snapshot not found"}
        </div>
      </div>
    );
  }

  const isCp = snap.source_hint === "CREDIT_PERIOD";
  const isPublished = snap.status === "PUBLISHED";
  const isStaged = snap.status === "STAGED";

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-xs text-slate-500">
        <Link to="/snapshots" className="hover:underline">Workspace</Link>
        <span>›</span>
        <span className="text-slate-700">Snapshot {snap.id.slice(0, 8)}…</span>
      </nav>

      {/* Metadata header */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-800">
              {snap.source_hint} snapshot
              {snap.as_of_date ? ` — ${formatISTDate(snap.as_of_date)}` : ""}
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Uploaded by {snap.uploaded_by_email} · {formatISTDateTime(snap.uploaded_at)}
            </p>
          </div>
          <Badge variant={statusVariant(snap.status)}>{snap.status}</Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-xs text-slate-500">Entity</span>
            <p className="font-medium">{snap.entity_code}</p>
          </div>
          <div>
            <span className="text-xs text-slate-500">Rows</span>
            <p className="font-mono font-medium">
              {snap.row_count != null ? snap.row_count.toLocaleString() : "—"}
            </p>
          </div>
          {snap.total_outstanding && (
            <div>
              <span className="text-xs text-slate-500">Outstanding</span>
              <p className="font-medium">{formatINR(snap.total_outstanding)}</p>
            </div>
          )}
          {snap.published_at && (
            <div>
              <span className="text-xs text-slate-500">Published</span>
              <p className="text-xs">{formatISTDateTime(snap.published_at)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {isCp ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-2xl">📋</p>
          <p className="mt-2 text-sm font-medium text-slate-700">Credit Period snapshot</p>
          <p className="mt-1 text-xs text-slate-400">
            Credit Period uploads configure payment terms — they don't contain invoice rows.
          </p>
          <div className="mt-4">
            <Link to={`/snapshots/${id}/staging`}>
              <Button variant="secondary" size="sm">View credit period diff</Button>
            </Link>
          </div>
        </Card>
      ) : isStaged ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-2xl">🔍</p>
          <p className="mt-2 text-sm font-medium text-slate-700">Snapshot awaiting review</p>
          <p className="mt-1 text-xs text-slate-400">
            This snapshot is staged. Review and publish it to view individual invoices.
          </p>
          <div className="mt-4">
            <Link to={`/staging/${id}`}>
              <Button variant="primary" size="sm">Review staging →</Button>
            </Link>
          </div>
        </Card>
      ) : isPublished ? (
        <Card className="px-5 py-5">
          <p className="mb-3 text-sm font-medium text-slate-700">
            Invoices published from this snapshot
          </p>
          <p className="text-xs text-slate-500 mb-4">
            This snapshot's invoices have been merged into the live ledger for{" "}
            <strong>{snap.entity_code}</strong>
            {snap.as_of_date ? ` as of ${formatISTDate(snap.as_of_date)}` : ""}.
          </p>
          <div className="flex gap-2">
            <Link to={`/dashboard?entity=${snap.entity_code}`}>
              <Button variant="primary" size="sm">View dashboard →</Button>
            </Link>
            <Link to={`/exceptions?entity=${snap.entity_code}`}>
              <Button variant="secondary" size="sm">View exceptions</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="px-6 py-10 text-center">
          <p className="text-xs text-slate-400">
            This snapshot has status <strong>{snap.status}</strong> and cannot be browsed.
          </p>
        </Card>
      )}
    </div>
  );
}
