/**
 * A6 — Reconciliation
 * Route: /admin/reconciliation   Roles: ADMIN (write), all non-PENDING (read)
 * Per wireframes README: ADMIN-writes-A6 resolution pending spec clarification.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { ReconciliationResponse, SnapshotListResponse, SnapshotListRow } from "@/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatISTDate, formatISTDateTime } from "@/lib/format";

function statusBadge(status: string) {
  const map: Record<string, "success" | "error" | "neutral"> = {
    MATCHED: "success",
    MISMATCHED: "error",
    UNRECONCILED: "neutral",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

function signedAmount(delta: string | null, currency: "INR" | "AED"): string {
  if (delta === null) return "—";
  const n = parseFloat(delta);
  if (isNaN(n)) return "—";
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatCurrency(delta, currency)}`;
}

function RecentReconciliationsTable({
  snapshots,
  currentEntityCode,
  onSelectSnapshot,
}: {
  snapshots: SnapshotListRow[];
  currentEntityCode: string;
  onSelectSnapshot: (id: string) => void;
}) {
  const currency = currentEntityCode === "UAE" ? "AED" : "INR";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent reconciliations (last 8 snapshots · {currentEntityCode})</CardTitle>
        <p className="text-xs text-slate-400 mt-0.5">
          Spot drift — if delta increases snapshot-over-snapshot, investigate unmapped exception growth.
        </p>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr className="text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-2.5 text-left font-medium">As-of date</th>
              <th className="px-3 py-2.5 text-left font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Delta</th>
              <th className="px-3 py-2.5 text-right font-medium">Tally/Xero closing AR</th>
              <th className="px-3 py-2.5 text-left font-medium">Updated at</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {snapshots.map((s) => {
              const r = s.reconciliation;
              const reconStatus = r?.status ?? "UNRECONCILED";
              const rowBg =
                reconStatus === "MISMATCHED"
                  ? "hover:bg-red-50 cursor-pointer"
                  : "hover:bg-gray-50 cursor-pointer";
              return (
                <tr
                  key={s.id}
                  className={rowBg}
                  onClick={() => onSelectSnapshot(s.id)}
                  title="Click to view this snapshot's reconciliation"
                >
                  <td className="px-4 py-2 text-slate-700 font-medium">
                    {s.as_of_date ? formatISTDate(s.as_of_date) : "—"}
                  </td>
                  <td className="px-3 py-2">{statusBadge(reconStatus)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {signedAmount(r?.delta ?? null, currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r?.tally_xero_closing_ar
                      ? formatCurrency(r.tally_xero_closing_ar, currency)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {r?.updated_at ? formatISTDateTime(r.updated_at) : "—"}
                  </td>
                </tr>
              );
            })}
            {snapshots.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-slate-400">
                  No published snapshots found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
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

function PublishGateBanner({ status, isAdmin }: { status: string; isAdmin: boolean }) {
  const [overrideOpen, setOverrideOpen] = useState(false);

  if (status === "MATCHED") return null;

  return (
    <>
      <div className="flex items-center gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900">
        <span className="flex-1 text-sm font-medium">
          Next publish blocked — snapshot not reconciled. The next publish for this entity will 422
          with PRIOR_SNAPSHOT_UNRECONCILED until this is resolved.
        </span>
        {isAdmin && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOverrideOpen(true)}
          >
            Override next publish
          </Button>
        )}
      </div>

      <Modal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override next publish"
        size="sm"
      >
        <p className="text-sm text-slate-700">
          Override flow wiring pending. The actual override mechanism will be a follow-up PR. For
          now, file a JIRA / inform engineering.
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="primary" size="sm" onClick={() => setOverrideOpen(false)}>
            Got it
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function A6ReconciliationPage() {
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const isAdmin = user?.role === "ADMIN";
  const isAnalyst = user?.role === "ANALYST";
  const canWrite = isAdmin || isAnalyst;

  // Snapshot selector — also used for the historical table
  const { data: snapshots } = useQuery<SnapshotListResponse>({
    queryKey: ["snapshots-all"],
    queryFn: () => api.get<SnapshotListResponse>("/snapshots?page=1&page_size=8&status=PUBLISHED"),
  });

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const snapshotId = selectedSnapshotId || snapshots?.items?.[0]?.id || "";

  // Current entity for the selected snapshot (drives currency + history filter)
  const selectedSnapshot = snapshots?.items?.find((s) => s.id === snapshotId);
  const currentEntityCode = selectedSnapshot?.entity_code ?? snapshots?.items?.[0]?.entity_code ?? "IND";

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
        {!canWrite && " Read-only — ADMIN or ANALYST role required to enter closing AR."}
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

          {/* Publish-gate banner */}
          <PublishGateBanner status={data.status} isAdmin={isAdmin} />

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

          {/* Entry form — ADMIN or ANALYST */}
          {canWrite && (
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

      {/* Historical reconciliations table — always visible once snapshots load */}
      {snapshots && snapshots.items.length > 0 && (
        <div className="mt-6">
          <RecentReconciliationsTable
            snapshots={snapshots.items.filter(
              (s) => s.entity_code === currentEntityCode,
            )}
            currentEntityCode={currentEntityCode}
            onSelectSnapshot={(id) => setSelectedSnapshotId(id)}
          />
        </div>
      )}
    </div>
  );
}
