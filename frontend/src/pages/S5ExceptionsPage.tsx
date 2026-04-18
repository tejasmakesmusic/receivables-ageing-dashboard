/**
 * S5 — Exceptions list
 * Route: /exceptions   Roles: ANALYST, ADMIN
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { ExceptionListResponse, ExceptionListRow, ExceptionBucketListResponse } from "@/types";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";
import { cn } from "@/lib/utils";

function statusBadge(status: string) {
  const map: Record<string, "warning" | "success" | "muted"> = {
    ACTIVE: "warning",
    RESOLVED: "success",
    AUTO_RESOLVED: "muted",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Tag modal (create exception on an invoice)
// ---------------------------------------------------------------------------

interface TagModalProps {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
  buckets: ExceptionBucketListResponse | undefined;
}

function TagModal({ invoiceId, open, onClose, buckets }: TagModalProps) {
  const qc = useQueryClient();
  const [bucketCode, setBucketCode] = useState("");
  const [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");

  const create = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api.post(`/invoices/${invoiceId}/exceptions`, {
        bucket_type_code: bucketCode,
        reason,
        expected_resolution_date: expectedDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Tag exception" size="md">
      <div className="space-y-3">
        <Select
          label="Exception type"
          value={bucketCode}
          onChange={(e) => setBucketCode(e.target.value)}
        >
          <option value="">— Select type —</option>
          {(buckets?.items ?? [])
            .filter((b) => b.active)
            .map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
        </Select>
        <Textarea
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Describe why this invoice is flagged"
        />
        <Input
          label="Expected resolution date (optional)"
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
        />
      </div>
      <ModalFooter
        onClose={onClose}
        onConfirm={() => create.mutate()}
        confirmLabel="Tag"
        loading={create.isPending}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Resolve modal
// ---------------------------------------------------------------------------

interface ResolveModalProps {
  exception: ExceptionListRow;
  open: boolean;
  onClose: () => void;
}

function ResolveModal({ exception, open, onClose }: ResolveModalProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const resolve = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api.patch(`/invoices/${exception.invoice_id}/exceptions/${exception.id}`, {
        action: "RESOLVE",
        resolution_note: note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Resolve exception" size="sm">
      <p className="mb-3 text-sm text-slate-700">
        Resolving exception for <strong>{exception.invoice_ref}</strong> (
        {exception.canonical_name})
      </p>
      <Textarea
        label="Resolution note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Briefly describe resolution"
      />
      <ModalFooter
        onClose={onClose}
        onConfirm={() => resolve.mutate()}
        confirmLabel="Resolve"
        loading={resolve.isPending}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function S5ExceptionsPage() {
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [bucketFilter, setBucketFilter] = useState("");
  const [tagTarget, setTagTarget] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ExceptionListRow | null>(null);
  const PAGE_SIZE = 25;

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(entityFilter && { entity_code: entityFilter }),
    ...(statusFilter && { status: statusFilter }),
    ...(bucketFilter && { bucket_type_code: bucketFilter }),
  });

  const { data, isLoading } = useQuery<ExceptionListResponse>({
    queryKey: ["exceptions", page, entityFilter, statusFilter, bucketFilter],
    queryFn: () => api.get<ExceptionListResponse>(`/exceptions?${params}`),
  });

  const { data: buckets } = useQuery<ExceptionBucketListResponse>({
    queryKey: ["exception-buckets"],
    queryFn: () => api.get<ExceptionBucketListResponse>("/admin/exception-buckets"),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Exceptions</h1>
        <p className="text-xs text-slate-500">
          Exceptions are distinct from follow-ups — they flag invoice anomalies for review.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          label="Entity"
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setPage(1);
          }}
          className="w-32"
        >
          <option value="">All</option>
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </Select>
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="AUTO_RESOLVED">AUTO_RESOLVED</option>
        </Select>
        <Select
          label="Exception type"
          value={bucketFilter}
          onChange={(e) => {
            setBucketFilter(e.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All types</option>
          {(buckets?.items ?? []).map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-left font-medium">Party</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-left font-medium">Reason</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Tagged</th>
                <th className="px-3 py-2 text-left font-medium">Res. by</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((ex) => (
                <tr
                  key={ex.id}
                  className={cn(
                    "hover:bg-slate-50",
                    ex.status === "AUTO_RESOLVED" && "opacity-60",
                  )}
                >
                  <td className="px-3 py-2 font-mono text-xs">{ex.invoice_ref}</td>
                  <td className="px-3 py-2 max-w-[140px] truncate font-medium">
                    {ex.canonical_name}
                  </td>
                  <td className="px-3 py-2 text-xs">{ex.entity_code}</td>
                  <td className="px-3 py-2">
                    <Badge variant="info">{ex.bucket_type_code}</Badge>
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate text-xs text-slate-600">
                    {ex.reason}
                  </td>
                  <td className="px-3 py-2">{statusBadge(ex.status)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDate(ex.tagged_at)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {ex.expected_resolution_date
                      ? formatISTDate(ex.expected_resolution_date)
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {ex.status === "ACTIVE" && (
                        <button
                          onClick={() => setResolveTarget(ex)}
                          className="text-xs text-green-600 hover:underline"
                          aria-label="Resolve exception"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-400">
                    No exceptions matching filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="mt-3 flex justify-end">
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      </div>

      {/* Resolve modal */}
      {resolveTarget && (
        <ResolveModal
          exception={resolveTarget}
          open={!!resolveTarget}
          onClose={() => setResolveTarget(null)}
        />
      )}

      {/* Tag modal */}
      {tagTarget && (
        <TagModal
          invoiceId={tagTarget}
          open={!!tagTarget}
          onClose={() => setTagTarget(null)}
          buckets={buckets}
        />
      )}
    </div>
  );
}
