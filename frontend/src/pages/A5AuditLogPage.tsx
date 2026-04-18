/**
 * A5 — Audit log
 * Route: /admin/audit-log   Roles: ADMIN
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { AuditLogListResponse } from "@/types";
import { Input } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { formatISTDateTime } from "@/lib/format";

export function A5AuditLogPage() {
  const [page, setPage] = useState(1);
  const [actorEmail, setActorEmail] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [detailRow, setDetailRow] = useState<null | { before: unknown; after: unknown }>(null);
  const PAGE_SIZE = 50;

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(actorEmail && { actor_email: actorEmail }),
    ...(action && { action }),
    ...(entityType && { entity_type: entityType }),
  });

  const { data, isLoading } = useQuery<AuditLogListResponse>({
    queryKey: ["audit-log", page, actorEmail, action, entityType],
    queryFn: () => api.get<AuditLogListResponse>(`/admin/audit-log?${params}`),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="mb-4 text-lg font-semibold text-slate-800">Audit Log</h1>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          label="Actor email"
          value={actorEmail}
          onChange={(e) => { setActorEmail(e.target.value); setPage(1); }}
          placeholder="user@emb.global"
          className="w-48"
        />
        <Input
          label="Action"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          placeholder="e.g. publish_snapshot"
          className="w-48"
        />
        <Input
          label="Entity type"
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          placeholder="e.g. snapshots"
          className="w-40"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Entity type</th>
                <th className="px-3 py-2 text-left font-medium">Entity ID</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDateTime(row.created_at)}
                  </td>
                  <td className="px-3 py-2 text-xs">{row.actor_email ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.action}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.entity_type}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">
                    {row.entity_id ? row.entity_id.slice(0, 8) + "…" : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {(row.before || row.after) && (
                      <button
                        onClick={() => setDetailRow({ before: row.before, after: row.after })}
                        className="text-xs text-blue-600 hover:underline"
                        aria-label="View before/after diff"
                      >
                        Diff
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">
                    No log entries
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

      {/* Before/after diff modal */}
      <Modal
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title="Before / After"
        size="lg"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">Before</p>
            <pre className="overflow-auto rounded bg-slate-100 p-2 text-xs text-slate-700">
              {detailRow?.before ? JSON.stringify(detailRow.before, null, 2) : "null"}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-500">After</p>
            <pre className="overflow-auto rounded bg-slate-100 p-2 text-xs text-slate-700">
              {detailRow?.after ? JSON.stringify(detailRow.after, null, 2) : "null"}
            </pre>
          </div>
        </div>
      </Modal>
    </div>
  );
}
