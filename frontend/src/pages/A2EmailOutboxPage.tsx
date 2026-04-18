/**
 * A2 — Email outbox
 * Route: /admin/emails   Roles: ADMIN
 * Lists email_outbox rows. Mark-sent only. No SMTP send (M6-full).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { EmailOutboxListResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDateTime } from "@/lib/format";

function statusBadge(status: string) {
  const map: Record<string, "success" | "error" | "info" | "neutral"> = {
    SENT: "success",
    FAILED: "error",
    QUEUED: "info",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

export function A2EmailOutboxPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const PAGE_SIZE = 25;

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(statusFilter && { status: statusFilter }),
  });

  const { data, isLoading } = useQuery<EmailOutboxListResponse>({
    queryKey: ["email-outbox", page, statusFilter],
    queryFn: () => api.get<EmailOutboxListResponse>(`/admin/email-outbox?${params}`),
  });

  const markSent = useMutation<unknown, ApiError, string>({
    mutationFn: (id) => api.post(`/admin/email-outbox/${id}/mark-sent`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["email-outbox"] }),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Email Outbox</h1>
          <p className="text-xs text-slate-500">
            SMTP send is M6-full. Mark-sent manually as needed.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="w-36"
        >
          <option value="">All</option>
          <option value="QUEUED">QUEUED</option>
          <option value="SENT">SENT</option>
          <option value="FAILED">FAILED</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Subject</th>
                <th className="px-3 py-2 text-left font-medium">Rule type</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Attempts</th>
                <th className="px-3 py-2 text-left font-medium">Enqueued</th>
                <th className="px-3 py-2 text-left font-medium">Sent at</th>
                <th className="px-3 py-2 text-left font-medium">Last error</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 max-w-[200px] truncate text-xs font-medium">
                    {row.subject}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.rule_type}</td>
                  <td className="px-3 py-2">{statusBadge(row.status)}</td>
                  <td className="px-3 py-2 text-right text-xs">{row.attempts}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDateTime(row.enqueued_at)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {row.sent_at ? formatISTDateTime(row.sent_at) : "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[160px] truncate text-xs text-red-500">
                    {row.last_error ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {row.status !== "SENT" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={markSent.isPending}
                        onClick={() => markSent.mutate(row.id)}
                      >
                        Mark sent
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400">
                    No emails in outbox
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      </div>
    </div>
  );
}
