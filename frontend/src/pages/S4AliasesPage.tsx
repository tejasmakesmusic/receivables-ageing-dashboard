/**
 * S4 — Party aliases config
 * Route: /config/aliases   Roles: ANALYST, ADMIN
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { AliasListResponse, AliasRow } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";

export function S4AliasesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const PAGE_SIZE = 25;

  // Form state
  const [canonicalId, setCanonicalId] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(entityFilter && { entity_code: entityFilter }),
    ...(search && { q: search }),
  });

  const { data, isLoading } = useQuery<AliasListResponse>({
    queryKey: ["aliases", page, entityFilter, search],
    queryFn: () => api.get<AliasListResponse>(`/config/aliases?${params}`),
  });

  const create = useMutation<AliasRow, ApiError>({
    mutationFn: () =>
      api.post<AliasRow>("/config/aliases", {
        canonical_id: canonicalId,
        alias_text: aliasText,
        source: "MANUAL",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aliases"] });
      setAddOpen(false);
      setCanonicalId("");
      setAliasText("");
      setFormError(null);
    },
    onError: (err) => setFormError(err.message),
  });

  const totalPages = data ? Math.ceil(data.pagination.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Party Aliases</h1>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          + Add alias
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          label="Entity"
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
          className="w-32"
        >
          <option value="">All</option>
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </Select>
        <Input
          label="Search alias"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Filter by alias text…"
          className="w-56"
        />
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
                <th className="px-3 py-2 text-left font-medium">Alias text</th>
                <th className="px-3 py-2 text-left font-medium">Canonical party</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">{row.alias_text}</td>
                  <td className="px-3 py-2 font-medium">{row.canonical_name}</td>
                  <td className="px-3 py-2">
                    <Badge variant="neutral">{row.entity_code}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.source}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDate(row.created_at)}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-400">
                    No aliases found
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

      {/* Add modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add alias" size="sm">
        <div className="space-y-3">
          <Input
            label="Canonical party ID (UUID)"
            value={canonicalId}
            onChange={(e) => setCanonicalId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <Input
            label="Alias text"
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder="e.g. ACME CORP IND"
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
