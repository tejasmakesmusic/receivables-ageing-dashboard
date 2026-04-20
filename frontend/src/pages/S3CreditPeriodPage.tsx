/**
 * S3 — Credit period config
 * Route: /config/credit-period   Roles: ANALYST, ADMIN (Edit); CFO (read-only)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type {
  CreditPeriodListResponse,
  CreditPeriodRow,
  CurrentUser,
  DefaultCpReportResponse,
  DefaultCpPartyReportRow,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";

// Response shape for POST /config/credit-period/{canonical_id}
interface CreditPeriodEditResponse {
  result: "inserted" | "superseded" | "noop";
  config_id: string;
  days: number;
  reason_note: string | null;
  valid_from: string;
}

export function S3CreditPeriodPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<CreditPeriodRow | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const PAGE_SIZE = 25;

  // Default-CP report section (A.4 — spec §13 #5)
  // Use the same entity selector as the main list; fall back to "IND" when "All" is selected.
  const defaultCpEntity = (entityFilter === "" ? "IND" : entityFilter) as "IND" | "UAE";
  const [defaultCpEditRow, setDefaultCpEditRow] = useState<DefaultCpPartyReportRow | null>(null);
  const [defaultCpEditDays, setDefaultCpEditDays] = useState("");
  const [defaultCpEditNote, setDefaultCpEditNote] = useState("");
  const [defaultCpEditError, setDefaultCpEditError] = useState<string | null>(null);

  // Add-form state
  const [canonicalId, setCanonicalId] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Edit-form state
  const [editDays, setEditDays] = useState("");
  const [editReasonNote, setEditReasonNote] = useState("");
  const [editFormError, setEditFormError] = useState<string | null>(null);

  // Fetch current user to gate Edit button visibility
  const { data: me } = useQuery<CurrentUser>({
    queryKey: ["me"],
    queryFn: () => api.get<CurrentUser>("/auth/me"),
    staleTime: 60_000,
  });

  const canEdit = me?.role === "ADMIN" || me?.role === "ANALYST";

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(entityFilter && { entity_code: entityFilter }),
  });

  const { data, isLoading } = useQuery<CreditPeriodListResponse>({
    queryKey: ["credit-periods", page, entityFilter],
    queryFn: () => api.get<CreditPeriodListResponse>(`/config/credit-period?${params}`),
  });

  // A.4 — default-CP report
  const { data: defaultCpData, isLoading: defaultCpLoading } = useQuery<DefaultCpReportResponse>({
    queryKey: ["default-cp-parties", defaultCpEntity],
    queryFn: () =>
      api.get<DefaultCpReportResponse>(
        `/config/credit-period/default-parties?entity_code=${defaultCpEntity}`,
      ),
    // A 404 (no published snapshot yet) is not an error we want to surface as a crash
    retry: false,
  });

  const defaultCpEditMutation = useMutation<
    { result: string; config_id: string; days: number; reason_note: string | null; valid_from: string },
    ApiError
  >({
    mutationFn: () =>
      api.post(`/config/credit-period/${defaultCpEditRow!.canonical_id}`, {
        days: parseInt(defaultCpEditDays, 10),
        reason_note: defaultCpEditNote || null,
      }),
    onSuccess: () => {
      // Refetch both the default-parties list and the CP master list so the party
      // disappears from default-parties and appears in CP master.
      qc.invalidateQueries({ queryKey: ["default-cp-parties"] });
      qc.invalidateQueries({ queryKey: ["credit-periods"] });
      setDefaultCpEditRow(null);
      setDefaultCpEditDays("");
      setDefaultCpEditNote("");
      setDefaultCpEditError(null);
      setSuccessMsg("Credit period set. Party will no longer appear in default-CP list.");
      setTimeout(() => setSuccessMsg(null), 6000);
    },
    onError: (err) => {
      setDefaultCpEditError(err.message);
    },
  });

  function openDefaultCpEditModal(party: DefaultCpPartyReportRow) {
    setDefaultCpEditRow(party);
    setDefaultCpEditDays("");
    setDefaultCpEditNote("");
    setDefaultCpEditError(null);
  }

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

  const editMutation = useMutation<CreditPeriodEditResponse, ApiError>({
    mutationFn: () =>
      api.post<CreditPeriodEditResponse>(`/config/credit-period/${editRow!.canonical_id}`, {
        days: parseInt(editDays, 10),
        reason_note: editReasonNote || null,
      }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["credit-periods"] });
      setEditRow(null);
      setEditDays("");
      setEditReasonNote("");
      setEditFormError(null);
      const today = new Date().toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        timeZone: "Asia/Kolkata",
      });
      if (resp.result === "noop") {
        setSuccessMsg("No change — values already match the active config.");
      } else {
        setSuccessMsg(`Updated. Old config closed, new config effective ${today}.`);
      }
      setTimeout(() => setSuccessMsg(null), 6000);
    },
    onError: (err) => {
      setEditFormError(err.message);
    },
  });

  function openEditModal(row: CreditPeriodRow) {
    setEditRow(row);
    setEditDays(String(row.credit_days));
    setEditReasonNote(row.reason_note ?? "");
    setEditFormError(null);
  }

  const totalPages = data ? Math.ceil(data.pagination.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Credit Period Config</h1>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          + Add
        </Button>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {successMsg}
        </div>
      )}

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
                {canEdit && (
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                )}
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
                  {canEdit && (
                    <td className="px-3 py-2">
                      {/* Only show Edit on open (active) rows */}
                      {row.valid_to === null ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openEditModal(row)}
                        >
                          Edit
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="px-3 py-6 text-center text-xs text-slate-400">
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

      {/* Edit modal (EditCreditPeriodModal) — reused for both CP master and default-CP section */}
      <Modal
        open={editRow !== null}
        onClose={() => { setEditRow(null); setEditFormError(null); }}
        title={`Edit credit period — ${editRow?.canonical_name ?? ""}`}
        size="md"
      >
        <p className="mb-3 text-xs text-slate-500">
          Supersedes the active config. The old row will be closed (valid_to = yesterday) and
          a new row inserted effective today.
        </p>
        <div className="space-y-3">
          <Input
            label="Credit days"
            type="number"
            min="0"
            value={editDays}
            onChange={(e) => setEditDays(e.target.value)}
            placeholder="e.g. 25"
          />
          <Textarea
            label="Reason note (optional)"
            value={editReasonNote}
            onChange={(e) => setEditReasonNote(e.target.value)}
            placeholder="e.g. Yatra terms changed per CFO email 2026-04-19"
          />
          {editFormError && <p className="text-xs text-red-600">{editFormError}</p>}
        </div>
        <ModalFooter
          onClose={() => { setEditRow(null); setEditFormError(null); }}
          onConfirm={() => editMutation.mutate()}
          confirmLabel="Save"
          loading={editMutation.isPending}
        />
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* A.4 — Parties on default credit period (spec §13 #5)               */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              Parties on default credit period
              {defaultCpData && (
                <Badge variant="warning" className="ml-2">
                  {defaultCpData.total_parties_on_default}
                </Badge>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Parties in <strong>{defaultCpEntity}</strong> whose open invoices use the entity
              default — no party-specific credit period configured yet.
              {defaultCpData && (
                <span className="ml-1">
                  As-of {defaultCpData.as_of_date} · {defaultCpData.currency_display}
                </span>
              )}
            </p>
          </div>
          {/* Entity toggle — reuses the top-level Select state */}
          <Select
            label="Entity"
            value={entityFilter}
            onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
            className="w-28"
          >
            <option value="">IND</option>
            <option value="IND">IND</option>
            <option value="UAE">UAE</option>
          </Select>
        </div>

        {defaultCpLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-amber-100 bg-white">
            <table className="w-full text-sm" aria-label="Parties on default credit period">
              <thead className="bg-amber-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Party</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Outstanding ({defaultCpData?.currency_display ?? "—"})
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Open invoices</th>
                  {canEdit && (
                    <th className="px-3 py-2 text-left font-medium">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(defaultCpData?.parties ?? []).map((party) => (
                  <tr key={party.canonical_id} className="hover:bg-amber-50/40">
                    <td className="px-3 py-2 font-medium">{party.canonical_name}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {Number(party.total_outstanding).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right">{party.n_open_invoices}</td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openDefaultCpEditModal(party)}
                        >
                          Set custom CP
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {(!defaultCpData || defaultCpData.parties.length === 0) && (
                  <tr>
                    <td
                      colSpan={canEdit ? 4 : 3}
                      className="px-3 py-6 text-center text-xs text-slate-400"
                    >
                      {defaultCpData
                        ? "No parties on default credit period — all parties have custom CP configured."
                        : "No published snapshot available for this entity."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* EditCreditPeriodModal — reused from A.2, opened from default-CP section */}
      <Modal
        open={defaultCpEditRow !== null}
        onClose={() => { setDefaultCpEditRow(null); setDefaultCpEditError(null); }}
        title={`Set custom CP — ${defaultCpEditRow?.canonical_name ?? ""}`}
        size="md"
      >
        <p className="mb-3 text-xs text-slate-500">
          Sets a party-specific credit period. Once saved, this party will no longer appear
          in the default-CP list and a new credit_period_config row will be active immediately.
        </p>
        <div className="space-y-3">
          <Input
            label="Credit days"
            type="number"
            min="0"
            value={defaultCpEditDays}
            onChange={(e) => setDefaultCpEditDays(e.target.value)}
            placeholder="e.g. 30"
          />
          <Textarea
            label="Reason note (optional)"
            value={defaultCpEditNote}
            onChange={(e) => setDefaultCpEditNote(e.target.value)}
            placeholder="e.g. Standard 30-day terms confirmed by account manager"
          />
          {defaultCpEditError && (
            <p className="text-xs text-red-600">{defaultCpEditError}</p>
          )}
        </div>
        <ModalFooter
          onClose={() => { setDefaultCpEditRow(null); setDefaultCpEditError(null); }}
          onConfirm={() => defaultCpEditMutation.mutate()}
          confirmLabel="Save"
          loading={defaultCpEditMutation.isPending}
        />
      </Modal>
    </div>
  );
}
