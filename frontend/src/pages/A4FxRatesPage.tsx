/**
 * A4 — FX rates admin
 * Route: /admin/fx-rates   Roles: ADMIN
 * Rows are immutable after creation (spec D15).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { FxRateListResponse, FxRateRow } from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";

export function A4FxRatesPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const PAGE_SIZE = 25;

  const [fromCcy, setFromCcy] = useState("AED");
  const [toCcy, setToCcy] = useState("INR");
  const [rate, setRate] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<FxRateListResponse>({
    queryKey: ["fx-rates", page],
    queryFn: () =>
      api.get<FxRateListResponse>(`/config/fx-rates?page=${page}&page_size=${PAGE_SIZE}`),
  });

  const create = useMutation<FxRateRow, ApiError>({
    mutationFn: () =>
      api.post<FxRateRow>("/config/fx-rates", {
        from_ccy: fromCcy.toUpperCase(),
        to_ccy: toCcy.toUpperCase(),
        rate: parseFloat(rate),
        valid_from: validFrom,
        notes: notes || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fx-rates"] });
      setAddOpen(false);
      setRate(""); setValidFrom(""); setNotes("");
      setFormError(null);
    },
    onError: (err) => setFormError(err.message),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">FX Rates</h1>
          <p className="text-xs text-slate-500">
            Rates are immutable after creation. Pin by invoice date.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>+ Add rate</Button>
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
                <th className="px-3 py-2 text-left font-medium">From</th>
                <th className="px-3 py-2 text-left font-medium">To</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-left font-medium">Valid from</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Created by</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{row.from_ccy}</td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{row.to_ccy}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{row.rate}</td>
                  <td className="px-3 py-2 text-xs">{formatISTDate(row.valid_from)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.source}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{row.created_by_email ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDate(row.created_at)}
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">
                    No FX rates configured
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add FX rate" size="sm">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              label="From currency"
              value={fromCcy}
              onChange={(e) => setFromCcy(e.target.value)}
              placeholder="AED"
              className="w-24"
            />
            <Input
              label="To currency"
              value={toCcy}
              onChange={(e) => setToCcy(e.target.value)}
              placeholder="INR"
              className="w-24"
            />
          </div>
          <Input
            label="Rate"
            type="number"
            step="0.000001"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="e.g. 22.85"
          />
          <Input
            label="Valid from"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <Textarea
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Source or context"
          />
          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>
        <ModalFooter
          onClose={() => setAddOpen(false)}
          onConfirm={() => create.mutate()}
          confirmLabel="Add"
          loading={create.isPending}
        />
      </Modal>
    </div>
  );
}
