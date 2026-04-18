/**
 * S2 — Staging review
 * Route: /staging/:snapshot_id   Roles: ANALYST, ADMIN
 */
import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type {
  StagingViewResponse,
  StagingInvoiceRow,
  PublishGate,
  AliasCandidate,
  StagingPatchResponse,
  WarningsAckResponse,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { formatISTDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceBadge(conf: string) {
  const map: Record<string, "success" | "warning" | "error" | "neutral"> = {
    EXACT: "success",
    FUZZY_HIGH: "warning",
    FUZZY_LOW: "error",
    UNMAPPED: "neutral",
  };
  return <Badge variant={map[conf] ?? "neutral"}>{conf.replace("_", " ")}</Badge>;
}

function gateLine(ok: boolean, label: string) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={ok ? "text-green-600" : "text-red-500"}>{ok ? "✓" : "✗"}</span>
      <span className={ok ? "text-slate-600" : "text-slate-800 font-medium"}>{label}</span>
    </div>
  );
}

function PublishGatePanel({
  gate,
  onAckWarnings,
  acking,
}: {
  gate: PublishGate;
  onAckWarnings: (codes: string[]) => void;
  acking: boolean;
}) {
  const unmappedOk = gate.unmapped_parties_count === 0;
  const warningsOk = gate.warnings_unacknowledged.length === 0;
  const parseOk = gate.parse_errors_unresolved_count === 0;
  const roleOk = gate.role_permits_publish;

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        gate.ok ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">Publish gate</span>
        <Badge variant={gate.ok ? "success" : "warning"}>{gate.ok ? "READY" : "BLOCKED"}</Badge>
      </div>
      <div className="space-y-1">
        {gateLine(unmappedOk, `Party mapping: ${gate.unmapped_parties_count} unmapped`)}
        {gateLine(gate.fuzzy_high_pending_count === 0, `Fuzzy-high pending: ${gate.fuzzy_high_pending_count}`)}
        {gateLine(warningsOk, `Warnings acknowledged: ${gate.warnings_unacknowledged.join(", ") || "all clear"}`)}
        {gateLine(parseOk, `Parse errors resolved: ${gate.parse_errors_unresolved_count} remaining`)}
        {gateLine(roleOk, roleOk ? "Role permits publish" : "Your role cannot publish")}
      </div>
      {gate.warnings_unacknowledged.length > 0 && (
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            loading={acking}
            onClick={() => onAckWarnings(gate.warnings_unacknowledged)}
          >
            Acknowledge all warnings ({gate.warnings_unacknowledged.length})
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row action modal
// ---------------------------------------------------------------------------

interface RowActionModalProps {
  row: StagingInvoiceRow;
  open: boolean;
  onClose: () => void;
  onAction: (payload: Record<string, unknown>) => void;
  loading: boolean;
}

function RowActionModal({ row, open, onClose, onAction, loading }: RowActionModalProps) {
  const [action, setAction] = useState<
    "resolve_alias" | "create_canonical" | "override_credit_days" | "dismiss_parse_error"
  >("resolve_alias");
  const [selectedCanonical, setSelectedCanonical] = useState<AliasCandidate | null>(null);
  const [canonicalName, setCanonicalName] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [createAlias, setCreateAlias] = useState(true);

  function handleConfirm() {
    if (action === "resolve_alias" && selectedCanonical) {
      onAction({ action: "resolve_alias", canonical_id: selectedCanonical.canonical_id, create_alias: createAlias });
    } else if (action === "create_canonical") {
      onAction({ action: "create_canonical", canonical_name: canonicalName, alias_text: row.party_name_raw });
    } else if (action === "override_credit_days") {
      onAction({ action: "override_credit_days", credit_days: Number(creditDays) });
    } else if (action === "dismiss_parse_error" && row.status === "PARSE_ERROR") {
      onAction({ action: "dismiss_parse_error", reason: dismissReason });
    }
  }

  const candidates = row.alias_resolution.candidates;

  return (
    <Modal open={open} onClose={onClose} title={`Row ${row.row_index} — ${row.party_name_raw}`} size="md">
      <div className="space-y-3">
        <Select
          label="Action"
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
        >
          <option value="resolve_alias">Resolve alias (pick canonical)</option>
          <option value="create_canonical">Create new canonical party</option>
          <option value="override_credit_days">Override credit days</option>
          {row.status === "PARSE_ERROR" && (
            <option value="dismiss_parse_error">Dismiss parse error</option>
          )}
        </Select>

        {action === "resolve_alias" && (
          <div className="space-y-2">
            {candidates.length === 0 ? (
              <p className="text-xs text-slate-500">No candidates — use "Create new canonical" instead.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Select canonical:</p>
                {candidates.map((c) => (
                  <label key={c.canonical_id} className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-slate-50">
                    <input
                      type="radio"
                      name="canonical"
                      value={c.canonical_id}
                      checked={selectedCanonical?.canonical_id === c.canonical_id}
                      onChange={() => setSelectedCanonical(c)}
                    />
                    <span className="text-sm font-medium">{c.canonical_name}</span>
                    <span className="text-xs text-slate-400">score: {c.score.toFixed(0)}%</span>
                  </label>
                ))}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={createAlias}
                onChange={(e) => setCreateAlias(e.target.checked)}
              />
              Save as alias for future uploads
            </label>
          </div>
        )}

        {action === "create_canonical" && (
          <Input
            label="Canonical party name"
            value={canonicalName}
            onChange={(e) => setCanonicalName(e.target.value)}
            placeholder="e.g. Acme Corp India Pvt Ltd"
          />
        )}

        {action === "override_credit_days" && (
          <Input
            label="Credit days override"
            type="number"
            min="0"
            value={creditDays}
            onChange={(e) => setCreditDays(e.target.value)}
            placeholder="e.g. 30"
          />
        )}

        {action === "dismiss_parse_error" && (
          <Textarea
            label="Dismiss reason (required)"
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            placeholder="Why is this row being dismissed?"
          />
        )}
      </div>
      <ModalFooter
        onClose={onClose}
        onConfirm={handleConfirm}
        confirmLabel="Apply"
        loading={loading}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function S2StagingPage() {
  const { snapshot_id } = useParams<{ snapshot_id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [activeRow, setActiveRow] = useState<StagingInvoiceRow | null>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const PAGE_SIZE = 50;

  const { data, isLoading, error } = useQuery<StagingViewResponse>({
    queryKey: ["staging", snapshot_id, page],
    queryFn: () =>
      api.get<StagingViewResponse>(
        `/snapshots/${snapshot_id}/staging?offset=${(page - 1) * PAGE_SIZE}&limit=${PAGE_SIZE}`,
      ),
    enabled: !!snapshot_id,
  });

  const patchRow = useMutation<StagingPatchResponse, ApiError, { rowIndex: number; payload: Record<string, unknown> }>({
    mutationFn: ({ rowIndex, payload }) =>
      api.patch<StagingPatchResponse>(`/snapshots/${snapshot_id}/staging/${rowIndex}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staging", snapshot_id] });
      setActiveRow(null);
    },
  });

  const ackWarnings = useMutation<WarningsAckResponse, ApiError, string[]>({
    mutationFn: (codes) =>
      api.patch<WarningsAckResponse>(`/snapshots/${snapshot_id}/warnings/ack`, { codes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staging", snapshot_id] });
    },
  });

  const publishMutation = useMutation<unknown, ApiError>({
    mutationFn: () => api.post(`/snapshots/${snapshot_id}/publish`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staging", snapshot_id] });
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      setPublishConfirm(false);
      navigate("/upload");
    },
  });

  const discardMutation = useMutation<unknown, ApiError>({
    mutationFn: () => api.post(`/snapshots/${snapshot_id}/discard`, { reason: "Discarded via UI" }),
    onSuccess: () => {
      setDiscardConfirm(false);
      navigate("/upload");
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <p className="text-red-600">Failed to load staging view. {error?.message}</p>
        <Link to="/upload" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          ← Back to Upload
        </Link>
      </div>
    );
  }

  const isInvoiceRows = data.source_hint !== "CREDIT_PERIOD";
  const invoiceRows = isInvoiceRows ? (data.rows as StagingInvoiceRow[]) : [];
  const totalPages = Math.ceil(data.pagination.total / PAGE_SIZE);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Breadcrumb */}
      <nav className="mb-4 text-xs text-slate-500">
        <Link to="/upload" className="hover:underline">
          Upload
        </Link>{" "}
        / <span className="font-mono">{data.snapshot_id.slice(0, 8)}…</span>
      </nav>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Staging Review</h1>
          <p className="text-xs text-slate-500">
            {data.entity_code} · {data.source_hint} ·{" "}
            {data.as_of_date ? formatISTDate(data.as_of_date) : "—"} · uploaded by {data.uploaded_by}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDiscardConfirm(true)}
            disabled={data.snapshot_status !== "STAGED"}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!data.publish_gate.ok || data.snapshot_status !== "STAGED"}
            onClick={() => setPublishConfirm(true)}
          >
            Publish
          </Button>
        </div>
      </div>

      {/* Status badge */}
      {data.snapshot_status !== "STAGED" && (
        <div className="mb-4 rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">
          This snapshot is <strong>{data.snapshot_status}</strong>. Read-only view.
        </div>
      )}

      {/* Totals */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Invoices", value: data.totals.invoices_total },
          { label: "OK", value: data.totals.invoices_ok },
          { label: "Parse errors", value: data.totals.invoices_parse_error },
          { label: "Warnings", value: data.totals.parse_warnings },
        ].map((t) => (
          <div key={t.label} className="rounded border border-gray-200 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className="text-lg font-semibold text-slate-800">{t.value}</p>
          </div>
        ))}
      </div>

      {/* Publish gate */}
      <div className="mb-4">
        <PublishGatePanel
          gate={data.publish_gate}
          onAckWarnings={(codes) => ackWarnings.mutate(codes)}
          acking={ackWarnings.isPending}
        />
      </div>

      {/* Invoice rows table */}
      {isInvoiceRows && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Party (raw)</th>
                <th className="px-3 py-2 text-left font-medium">Match</th>
                <th className="px-3 py-2 text-left font-medium">Canonical</th>
                <th className="px-3 py-2 text-left font-medium">Ref</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Credit src</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoiceRows.map((row) => {
                const dismissed = row.analyst_overrides.dismissed;
                return (
                  <tr
                    key={row.row_index}
                    className={cn(
                      "hover:bg-slate-50",
                      dismissed && "opacity-50",
                      row.status === "PARSE_ERROR" && !dismissed && "bg-red-50",
                    )}
                  >
                    <td className="px-3 py-2 text-xs text-slate-400">{row.row_index}</td>
                    <td className="px-3 py-2 max-w-[160px] truncate font-medium">
                      {row.party_name_raw}
                    </td>
                    <td className="px-3 py-2">
                      {confidenceBadge(row.alias_resolution.confidence)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[140px] truncate">
                      {row.alias_resolution.matched_canonical_name ??
                        row.analyst_overrides.resolved_canonical_id ??
                        "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.invoice_ref ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {row.amount ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.analyst_overrides.credit_days_source ? (
                        <Badge
                          variant={
                            row.analyst_overrides.credit_days_source === "MANUAL"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {row.analyst_overrides.credit_days_source}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "PARSE_ERROR" ? (
                        <Badge variant="error">PARSE ERROR</Badge>
                      ) : (
                        <Badge variant="success">OK</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {data.snapshot_status === "STAGED" && (
                        <button
                          onClick={() => setActiveRow(row)}
                          className="text-xs text-blue-600 hover:underline"
                          aria-label={`Edit row ${row.row_index}`}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {invoiceRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">
                    No rows on this page
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </Button>
          <span className="text-slate-500">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </Button>
        </div>
      )}

      {/* Row action modal */}
      {activeRow && (
        <RowActionModal
          row={activeRow}
          open={!!activeRow}
          onClose={() => setActiveRow(null)}
          onAction={(payload) =>
            patchRow.mutate({ rowIndex: activeRow.row_index, payload })
          }
          loading={patchRow.isPending}
        />
      )}

      {/* Publish confirm */}
      <Modal open={publishConfirm} onClose={() => setPublishConfirm(false)} title="Publish snapshot">
        <p className="text-sm text-slate-700">
          Publishing will push these invoices to the live AR ledger. This cannot be undone. Confirm?
        </p>
        <ModalFooter
          onClose={() => setPublishConfirm(false)}
          onConfirm={() => publishMutation.mutate()}
          confirmLabel="Publish"
          loading={publishMutation.isPending}
        />
      </Modal>

      {/* Discard confirm */}
      <Modal open={discardConfirm} onClose={() => setDiscardConfirm(false)} title="Discard snapshot" size="sm">
        <p className="text-sm text-slate-700">Discard this snapshot? This cannot be undone.</p>
        <ModalFooter
          onClose={() => setDiscardConfirm(false)}
          onConfirm={() => discardMutation.mutate()}
          confirmLabel="Discard"
          destructive
          loading={discardMutation.isPending}
        />
      </Modal>
    </div>
  );
}
