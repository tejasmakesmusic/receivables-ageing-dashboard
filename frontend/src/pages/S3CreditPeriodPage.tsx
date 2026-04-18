/**
 * S3 — Credit period config
 * Route: /config/credit-period   Roles: ANALYST, ADMIN
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { CreditPeriodListResponse, CreditPeriodRow } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";

export function S3CreditPeriodPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const PAGE_SIZE = 25;

  // Form state
  const [canonicalId, setCanonicalId] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(entityFilter && { entity_code: entityFilter }),
  });

  const { data, isLoading } = useQuery<CreditPeriodListResponse>({
    queryKey: ["credit-periods", page, entityFilter],
    queryFn: () => api.get<CreditPeriodListResponse>(`/config/credit-period?${params}`),
  });

  const create = useMutation<CreditPeriodRow, ApiError>({
    mutationFn: () =>
      api.post<CreditPeriodRow>("/config/credit-period", {
        canonical_id: canonicalId,
        credit_days: parseInt(creditDays, 10),
        valid_from: validFrom,
        reason_note: reasonNote || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-periods"] });
      setAddOpen(false);
      setCanonicalId("");
      setCreditDays("");
      setValidFrom("");
      setReasonNote("");
      setFormError(null);
    },
    onError: (err) => {
      setFormError(err.message);
    },
  });

  const totalPages = data ? Math.ceil(data.pagination.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Credit Period Config</h1>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          + Add
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
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
                <th className="px-3 py-2 text-left font-medium">Party</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-right font-medium">Credit days</th>
                <th className="px-3 py-2 text-left font-medium">Valid from</th>
                <th className="px-3 py-2 text-left font-medium">Valid to</th>
                <th className="px-3 py-2 text-left font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">{row.canonical_name}</td>
                  <td className="px-3 py-2">
                    <Badge variant="neutral">{row.entity_code}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{row.credit_days}</td>
                  <td className="px-3 py-2 text-xs">{formatISTDate(row.valid_from)}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.valid_to ? formatISTDate(row.valid_to) : <Badge variant="success">Active</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.reason_note ?? "—"}</td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">
                    No credit period configs
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
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add credit period" size="md">
        <div className="space-y-3">
          <Input
            label="Canonical party ID (UUID)"
            value={canonicalId}
            onChange={(e) => setCanonicalId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <Input
            label="Credit days"
            type="number"
            min="0"
            value={creditDays}
            onChange={(e) => setCreditDays(e.target.value)}
            placeholder="e.g. 30"
          />
          <Input
            label="Valid from"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <Textarea
            label="Reason note (optional)"
            value={reasonNote}
            onChange={(e) => setReasonNote(e.target.value)}
            placeholder="Why is this credit period being set?"
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
