/**
 * S6 — Follow-ups
 * Route: /follow-ups   Roles: ANALYST, ADMIN
 *
 * Full CRUD: list, create, edit, delete (ADMIN only).
 * No wireframe exists — design mirrors D1/S5 visual style.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type {
  FollowUpListResponse,
  FollowUpRow,
  FollowUpCreateRequest,
  FollowUpUpdateRequest,
  FollowUpChannel,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { BadgeVariant } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatISTDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHANNELS: FollowUpChannel[] = ["EMAIL", "CALL", "WHATSAPP", "MEETING"];
const PAGE_SIZE = 25;

const CHANNEL_BADGE_MAP: Record<FollowUpChannel, BadgeVariant> = {
  EMAIL: "info",
  CALL: "success",
  WHATSAPP: "success",
  MEETING: "warning",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelBadge(channel: string) {
  const v = CHANNEL_BADGE_MAP[channel as FollowUpChannel] ?? "neutral";
  return <Badge variant={v}>{channel}</Badge>;
}

function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (typeof err.detail === "string") return err.detail;
    if (Array.isArray(err.detail)) {
      const first = (err.detail as Array<{ msg?: string }>)[0];
      return first?.msg ?? err.message;
    }
    if (err.detail && typeof err.detail === "object") {
      const d = err.detail as Record<string, unknown>;
      return String(d.detail ?? d.message ?? err.message);
    }
    return err.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Create / Edit modal
// ---------------------------------------------------------------------------

type TargetType = "party" | "invoice";

interface FollowUpFormState {
  targetType: TargetType;
  canonical_id: string;
  invoice_id: string;
  channel: FollowUpChannel | "";
  date: string;
  contact_person: string;
  next_action_date: string;
  notes: string;
}

const EMPTY_FORM: FollowUpFormState = {
  targetType: "party",
  canonical_id: "",
  invoice_id: "",
  channel: "",
  date: "",
  contact_person: "",
  next_action_date: "",
  notes: "",
};

function rowToForm(row: FollowUpRow): FollowUpFormState {
  return {
    targetType: row.invoice_id ? "invoice" : "party",
    canonical_id: row.canonical_id,
    invoice_id: row.invoice_id ?? "",
    channel: row.channel,
    date: row.date,
    contact_person: row.contact_person ?? "",
    next_action_date: row.next_action_date ?? "",
    notes: row.notes ?? "",
  };
}

interface FollowUpModalProps {
  open: boolean;
  onClose: () => void;
  /** If provided, modal is in edit mode for this row. */
  editing: FollowUpRow | null;
}

function FollowUpModal({ open, onClose, editing }: FollowUpModalProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FollowUpFormState>(
    editing ? rowToForm(editing) : EMPTY_FORM,
  );
  const [serverError, setServerError] = useState<string | null>(null);

  // Reset form whenever the modal target changes
  const initialForm = editing ? rowToForm(editing) : EMPTY_FORM;

  function field<K extends keyof FollowUpFormState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setServerError(null);
    };
  }

  const isEdit = !!editing;

  const create = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body: FollowUpCreateRequest = {
        date: form.date,
        channel: form.channel as FollowUpChannel,
        contact_person: form.contact_person || null,
        next_action_date: form.next_action_date || null,
        notes: form.notes || null,
        ...(form.targetType === "party"
          ? { canonical_id: form.canonical_id, invoice_id: null }
          : { invoice_id: form.invoice_id, canonical_id: null }),
      };
      return api.post("/follow-ups", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-ups"] });
      onClose();
    },
    onError: (err) => setServerError(apiErrorMessage(err)),
  });

  const update = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body: FollowUpUpdateRequest = {
        date: form.date || null,
        channel: (form.channel as FollowUpChannel) || null,
        contact_person: form.contact_person || null,
        next_action_date: form.next_action_date || null,
        notes: form.notes || null,
      };
      return api.patch(`/follow-ups/${editing!.id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-ups"] });
      onClose();
    },
    onError: (err) => setServerError(apiErrorMessage(err)),
  });

  function validate(): string | null {
    if (!form.date) return "Date is required.";
    if (!form.channel) return "Channel is required.";
    if (!isEdit) {
      if (form.targetType === "party" && !form.canonical_id.trim())
        return "Party canonical ID is required.";
      if (form.targetType === "invoice" && !form.invoice_id.trim())
        return "Invoice ID is required.";
    }
    return null;
  }

  function handleSubmit() {
    const err = validate();
    if (err) {
      setServerError(err);
      return;
    }
    if (isEdit) {
      update.mutate();
    } else {
      create.mutate();
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={() => {
        setForm(initialForm);
        setServerError(null);
        onClose();
      }}
      title={isEdit ? "Edit follow-up" : "New follow-up"}
      size="md"
    >
      <div className="space-y-3">
        {/* Target — only shown on create */}
        {!isEdit && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">
              Target type
            </label>
            <div className="flex gap-4">
              {(["party", "invoice"] as TargetType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="targetType"
                    value={t}
                    checked={form.targetType === t}
                    onChange={() => setForm((f) => ({ ...f, targetType: t }))}
                    className="accent-indigo-600"
                  />
                  {t === "party" ? "Party (canonical ID)" : "Invoice (invoice ID)"}
                </label>
              ))}
            </div>
          </div>
        )}

        {!isEdit && form.targetType === "party" && (
          <Input
            label="Canonical party ID (UUID)"
            value={form.canonical_id}
            onChange={field("canonical_id")}
            placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
          />
        )}

        {!isEdit && form.targetType === "invoice" && (
          <Input
            label="Invoice ID (UUID)"
            value={form.invoice_id}
            onChange={field("invoice_id")}
            placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
          />
        )}

        {/* Edit: show read-only target info */}
        {isEdit && (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-medium">Party:</span> {editing!.canonical_name}
            {editing!.invoice_ref && (
              <>
                {" · "}
                <span className="font-medium">Invoice:</span> {editing!.invoice_ref}
              </>
            )}
          </div>
        )}

        <Select
          label="Channel"
          value={form.channel}
          onChange={field("channel")}
        >
          <option value="">— Select channel —</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>

        <Input
          label="Date"
          type="date"
          value={form.date}
          onChange={field("date")}
        />

        <Input
          label="Contact person (optional)"
          value={form.contact_person}
          onChange={field("contact_person")}
          placeholder="e.g. John Smith"
        />

        <Input
          label="Next action date (optional)"
          type="date"
          value={form.next_action_date}
          onChange={field("next_action_date")}
        />

        <Textarea
          label="Notes (optional)"
          value={form.notes}
          onChange={field("notes")}
          placeholder="Brief summary of the follow-up"
          rows={3}
        />

        {serverError && (
          <p role="alert" className="text-xs text-red-600">
            {serverError}
          </p>
        )}
      </div>

      <ModalFooter
        onClose={onClose}
        onConfirm={handleSubmit}
        confirmLabel={isEdit ? "Save changes" : "Create"}
        loading={isPending}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm modal
// ---------------------------------------------------------------------------

interface DeleteModalProps {
  row: FollowUpRow;
  open: boolean;
  onClose: () => void;
}

function DeleteModal({ row, open, onClose }: DeleteModalProps) {
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const del = useMutation<unknown, ApiError>({
    mutationFn: () => api.delete(`/follow-ups/${row.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["follow-ups"] });
      onClose();
    },
    onError: (err) => setServerError(apiErrorMessage(err)),
  });

  return (
    <Modal open={open} onClose={onClose} title="Delete follow-up" size="sm">
      <p className="text-sm text-slate-700">
        Delete the <strong>{row.channel}</strong> follow-up for{" "}
        <strong>{row.canonical_name}</strong> on{" "}
        <strong>{formatISTDate(row.date)}</strong>? This cannot be undone.
      </p>
      {serverError && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {serverError}
        </p>
      )}
      <ModalFooter
        onClose={onClose}
        onConfirm={() => del.mutate()}
        confirmLabel="Delete"
        loading={del.isPending}
        destructive
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function S6FollowUpsPage() {
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FollowUpRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FollowUpRow | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(entityFilter && { entity: entityFilter }),
    ...(channelFilter && { channel: channelFilter }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  });

  const { data, isLoading } = useQuery<FollowUpListResponse>({
    queryKey: ["follow-ups", page, entityFilter, channelFilter, dateFrom, dateTo],
    queryFn: () => api.get<FollowUpListResponse>(`/follow-ups?${params}`),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  function clearFilters() {
    setEntityFilter("");
    setChannelFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const hasFilters = entityFilter || channelFilter || dateFrom || dateTo;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Follow-ups</h1>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setCreateOpen(true)}
          data-testid="new-follow-up-btn"
        >
          + New follow-up
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {/* Entity toggle */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Entity</label>
          <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
            {(["", "IND", "UAE"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setEntityFilter(v);
                  setPage(1);
                }}
                className={`px-3 py-1.5 ${
                  entityFilter === v
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
                data-testid={`entity-toggle-${v || "all"}`}
              >
                {v || "All"}
              </button>
            ))}
          </div>
        </div>

        <Select
          label="Channel"
          id="filter-channel"
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value);
            setPage(1);
          }}
          className="w-40"
          data-testid="channel-filter"
        >
          <option value="">All channels</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>

        <Input
          label="From"
          id="filter-date-from"
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="w-36"
          data-testid="date-from-filter"
        />

        <Input
          label="To"
          id="filter-date-to"
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="w-36"
          data-testid="date-to-filter"
        />

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="mb-0.5 self-end text-xs text-indigo-600 hover:underline"
            data-testid="clear-filters"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm" data-testid="follow-ups-table">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Channel</th>
                <th className="px-3 py-2 text-left font-medium">Party</th>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-left font-medium">Contact</th>
                <th className="px-3 py-2 text-left font-medium">Next Action</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
                <th className="px-3 py-2 text-left font-medium">Logged by</th>
                <th className="px-3 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {formatISTDate(row.date)}
                  </td>
                  <td className="px-3 py-2">{channelBadge(row.channel)}</td>
                  <td className="px-3 py-2 max-w-[140px] truncate font-medium">
                    <Link
                      to={`/parties/${row.canonical_id}`}
                      className="text-indigo-600 hover:underline"
                    >
                      {row.canonical_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {row.invoice_id ? (
                      <Link
                        to={`/invoice/${row.invoice_id}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {row.invoice_ref ?? row.invoice_id}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 max-w-[100px] truncate">
                    {row.contact_person ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {row.next_action_date ? formatISTDate(row.next_action_date) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600 max-w-[180px] truncate" title={row.notes ?? ""}>
                    {row.notes ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {row.logged_by_email}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditTarget(row)}
                        className="text-xs text-indigo-600 hover:underline"
                        aria-label={`Edit follow-up for ${row.canonical_name}`}
                        data-testid="edit-btn"
                      >
                        Edit
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => setDeleteTarget(row)}
                          className="text-xs text-red-500 hover:underline"
                          aria-label={`Delete follow-up for ${row.canonical_name}`}
                          data-testid="delete-btn"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-12 text-center text-sm text-slate-400"
                    data-testid="empty-state"
                  >
                    No follow-ups found
                    {hasFilters && (
                      <>
                        {" "}—{" "}
                        <button
                          onClick={clearFilters}
                          className="text-indigo-600 hover:underline"
                        >
                          clear filters
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="mt-3 flex justify-end">
        <Pagination page={page} totalPages={totalPages} onPage={setPage} />
      </div>

      {/* Create modal */}
      {createOpen && (
        <FollowUpModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          editing={null}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <FollowUpModal
          open={!!editTarget}
          onClose={() => setEditTarget(null)}
          editing={editTarget}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <DeleteModal
          row={deleteTarget}
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
