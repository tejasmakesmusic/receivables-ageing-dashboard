/**
 * A3 — Exception bucket types admin
 * Route: /admin/exception-buckets   Roles: ADMIN
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { ExceptionBucketListResponse, ExceptionBucketRow } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";

export function A3ExceptionBucketsPage() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ExceptionBucketListResponse>({
    queryKey: ["exception-buckets"],
    queryFn: () => api.get<ExceptionBucketListResponse>("/admin/exception-buckets"),
  });

  const create = useMutation<ExceptionBucketRow, ApiError>({
    mutationFn: () =>
      api.post<ExceptionBucketRow>("/admin/exception-buckets", {
        code,
        name,
        description: description || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exception-buckets"] });
      setAddOpen(false);
      setCode(""); setName(""); setDescription("");
      setFormError(null);
    },
    onError: (err) => setFormError(err.message),
  });

  const toggle = useMutation<ExceptionBucketRow, ApiError, { id: string; active: boolean }>({
    mutationFn: ({ id, active }) =>
      api.patch<ExceptionBucketRow>(`/admin/exception-buckets/${id}`, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exception-buckets"] }),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Exception Bucket Types</h1>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Description</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Active exceptions</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{row.code}</td>
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 max-w-[200px] truncate">
                    {row.description ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={row.active ? "success" : "neutral"}>
                      {row.active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-slate-500">—</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDate(row.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggle.mutate({ id: row.id, active: !row.active })}
                      className="text-xs text-blue-600 hover:underline"
                      aria-label={row.active ? "Deactivate" : "Activate"}
                    >
                      {row.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">
                    No buckets configured
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add exception bucket" size="sm">
        <div className="space-y-3">
          <Input
            label="Code (e.g. DISPUTE)"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="DISPUTE"
          />
          <Input
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Invoice under dispute"
          />
          <Textarea
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When to use this bucket…"
          />
          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>
        <ModalFooter
          onClose={() => setAddOpen(false)}
          onConfirm={() => create.mutate()}
          confirmLabel="Create"
          loading={create.isPending}
        />
      </Modal>
    </div>
  );
}
