/**
 * A6 — Reconciliation
 * Route: /admin/reconciliation   Roles: ADMIN (write), all non-PENDING (read)
 * Per wireframes README: ADMIN-writes-A6 resolution pending spec clarification.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { ReconciliationResponse, SnapshotListResponse } from "@/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCurrency, formatISTDate, formatISTDateTime } from "@/lib/format";

function statusBadge(status: string) {
  const map: Record<string, "success" | "error" | "neutral"> = {
    MATCHED: "success",
    MISMATCHED: "error",
    UNRECONCILED: "neutral",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

function TileCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export function A6ReconciliationPage() {
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";

  // Snapshot selector
  const { data: snapshots } = useQuery<SnapshotListResponse>({
    queryKey: ["snapshots-all"],
    queryFn: () => api.get<SnapshotListResponse>("/snapshots?page=1&page_size=8&status=PUBLISHED"),
  });

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const snapshotId = selectedSnapshotId || snapshots?.items?.[0]?.id || "";

  const { data, isLoading, error } = useQuery<ReconciliationResponse, ApiError>({
    queryKey: ["reconciliation", snapshotId],
    queryFn: () => api.get<ReconciliationResponse>(`/snapshots/${snapshotId}/reconciliation`),
    enabled: !!snapshotId,
  });

  const [closingAr, setClosingAr] = useState("");
  const [notes, setNotes] = useState("");

  const save = useMutation<ReconciliationResponse, ApiError>({
    mutationFn: () =>
      api.post<ReconciliationResponse>(`/snapshots/${snapshotId}/reconciliation`, {
        tally_xero_closing_ar: parseFloat(closingAr),
        notes: notes || null,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["reconciliation", snapshotId] });
      setClosingAr(res.tally_xero_closing_ar ?? "");
      setNotes(res.notes ?? "");
    },
  });

  const currency = data?.entity_code === "UAE" ? "AED" : "INR";

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Reconciliation</h1>
      <p className="mt-0.5 text-xs text-slate-500">
        Compare Dashboard AR against Tally/Xero closing balance per snapshot.
        {!isAdmin && " Read-only — ADMIN role required to enter closing AR."}
      </p>

      {/* Snapshot selector */}
      <div className="mt-4 flex items-center gap-3">
        <label className="text-xs font-medium text-slate-600">Snapshot</label>
        <select
          value={selectedSnapshotId}
          onChange={(e) => setSelectedSnapshotId(e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {(snapshots?.items ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.entity_code} · {s.as_of_date ?? "—"} ({s.id.slice(0, 8)}…)
            </option>
          ))}
          {!snapshots?.items?.length && <option value="">No published snapshots</option>}
        </select>
      </div>

      {isLoading && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error.message}
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            {statusBadge(data.status)}
            <span className="text-xs text-slate-500">
              {data.entity_code} · as of {formatISTDate(data.snapshot_as_of_date)}
            </span>
            {data.entered_by && (
              <span className="text-xs text-slate-400">
                · entered by {data.entered_by.email} on {formatISTDateTime(data.entered_at ?? "")}
              </span>
            )}
          </div>

          {/* 4 tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TileCard
              label="Dashboard AR (computed)"
              value={formatCurrency(data.dashboard_ar, currency)}
              sub="Gross outstanding per ledger"
            />
            <TileCard
              label="Exception bucket total"
              value={formatCurrency(data.exception_bucket_total, currency)}
              sub="Active exception tags"
            />
            <TileCard
              label="Tally/Xero closing AR"
              value={
                data.tally_xero_closing_ar
                  ? formatCurrency(data.tally_xero_closing_ar, currency)
                  : "Not entered"
              }
              sub="User-entered closing balance"
            />
            <TileCard
              label="Delta"
              value={data.delta ? formatCurrency(data.delta, currency) : "—"}
              sub="Dashboard AR + Exceptions − Tally/Xero AR"
            />
          </div>

          {/* Formula caption */}
          <p className="text-xs text-slate-400">
            Formula: Delta = Dashboard AR + Exception buckets − Tally/Xero AR. When MATCHED, delta ≈ 0.
          </p>

          {/* Exception bucket breakdown */}
          {Object.keys(data.exception_bucket_breakdown).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Exception bucket breakdown</CardTitle>
              </CardHeader>
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="py-1 text-left font-medium">Bucket</th>
                    <th className="py-1 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(data.exception_bucket_breakdown).map(([code, amt]) => (
                    <tr key={code}>
                      <td className="py-1.5 text-slate-700">{code}</td>
                      <td className="py-1.5 text-right font-mono text-xs">
                        {formatCurrency(amt, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Entry form — ADMIN only */}
          {isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>Enter Tally/Xero closing AR</CardTitle>
              </CardHeader>
              <div className="space-y-3">
                <Input
                  label={`Closing AR (${currency})`}
                  type="number"
                  step="0.01"
                  value={closingAr}
                  onChange={(e) => setClosingAr(e.target.value)}
                  placeholder="e.g. 18720000"
                />
                <Textarea
                  label="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any reconciliation notes"
                />
                <Button
                  variant="primary"
                  size="md"
                  loading={save.isPending}
                  disabled={!closingAr}
                  onClick={() => save.mutate()}
                >
                  Save reconciliation
                </Button>
                {save.isError && (
                  <p className="text-xs text-red-600">{save.error?.message}</p>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
