/**
 * S5 — Exceptions list
 * Route: /exceptions   Roles: ANALYST, ADMIN
 *
 * Optional query param: ?snapshot_id=<uuid>
 * When present, fetches the snapshot's material_change_flags and renders
 * the orange collapsible banner above the main table (spec §13 #2, M5).
 */
import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type {
  ExceptionListResponse,
  ExceptionListRow,
  ExceptionBucketListResponse,
  MaterialChangeFlag,
  SnapshotDetailResponse,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";
import { formatISTDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Known seed bucket codes per spec D9 / migration 0003_m3_ingestion
// ---------------------------------------------------------------------------

const SEED_CODES = new Set(["LEGAL", "DISPUTED", "CN_PENDING", "WRITTEN_OFF"]);

// ---------------------------------------------------------------------------
// Bucket summary cards
// ---------------------------------------------------------------------------

interface BucketSummaryCardsProps {
  buckets: ExceptionBucketListResponse | undefined;
  exceptions: ExceptionListResponse | undefined;
  activeFilter: string;
  onFilter: (code: string) => void;
}

function BucketSummaryCards({
  buckets,
  exceptions,
  activeFilter,
  onFilter,
}: BucketSummaryCardsProps) {
  if (!buckets || buckets.items.length === 0) return null;

  // Build per-bucket aggregates from ACTIVE exception rows currently loaded.
  // NOTE: the page fetches /exceptions filtered by status=ACTIVE by default;
  // the cards count only rows present in the current page fetch — this gives
  // correct summary context while reusing the already-fetched data with no
  // extra network call.
  const activeRows = (exceptions?.items ?? []).filter((r) => r.status === "ACTIVE");

  const summary = new Map<string, { count: number; outstanding: number }>();
  for (const bucket of buckets.items) {
    summary.set(bucket.code, { count: 0, outstanding: 0 });
  }
  for (const row of activeRows) {
    const entry = summary.get(row.bucket_type_code);
    if (entry) {
      entry.count += 1;
      // outstanding_amount is not on ExceptionListRow; fall back to 0
    }
  }

  const activeBuckets = buckets.items.filter((b) => b.active);

  return (
    <div
      className="mb-5 flex gap-3 overflow-x-auto pb-1"
      data-testid="bucket-summary-row"
      role="list"
      aria-label="Exception type summary"
    >
      {activeBuckets.map((bucket) => {
        const isPreSeeded = bucket.pre_seeded ?? SEED_CODES.has(bucket.code);
        const agg = summary.get(bucket.code) ?? { count: 0, outstanding: 0 };
        const isActive = activeFilter === bucket.code;

        return (
          <button
            key={bucket.code}
            role="listitem"
            data-testid={`bucket-card-${bucket.code}`}
            aria-pressed={isActive}
            onClick={() => onFilter(isActive ? "" : bucket.code)}
            className={cn(
              "flex min-w-[140px] flex-shrink-0 flex-col items-center rounded-lg border p-3 text-center transition-shadow",
              isActive
                ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300"
                : "border-gray-200 bg-white hover:border-indigo-200 hover:shadow-sm",
            )}
          >
            <div className="mb-1.5 flex items-center gap-1.5 justify-center">
              <span className="text-xs font-medium text-slate-700 leading-tight">
                {bucket.name}
              </span>
              <Badge
                variant={isPreSeeded ? "muted" : "info"}
                data-testid={
                  isPreSeeded
                    ? `badge-preseeded-${bucket.code}`
                    : `badge-admin-${bucket.code}`
                }
              >
                {isPreSeeded ? "system" : "admin"}
              </Badge>
            </div>
            <div className="text-xl font-bold text-slate-800">{agg.count}</div>
            <div className="mt-0.5 text-xs text-slate-400">ACTIVE tags</div>
          </button>
        );
      })}

      {activeFilter && (
        <div className="flex items-center">
          <button
            onClick={() => onFilter("")}
            className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
            data-testid="bucket-filter-clear"
          >
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Material-change banner (M5 — spec §13 #2)
// ---------------------------------------------------------------------------

interface MaterialChangeBannerProps {
  flags: MaterialChangeFlag[];
}

function MaterialChangeBanner({ flags }: MaterialChangeBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (flags.length === 0) return null;

  return (
    <>
      {/* Header card */}
      <div className="mb-3 flex items-center justify-between rounded-lg border border-orange-300 bg-orange-50 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xl text-orange-500" aria-hidden>&#9888;</span>
          <div>
            <div className="text-sm font-medium text-orange-800">
              {flags.length} exception{flags.length !== 1 ? "s" : ""} flagged for review — invoice
              amount changed &gt;5% since tagged
            </div>
            <div className="mt-0.5 text-xs text-orange-600">
              Per spec consequence #2: exceptions on materially-changed invoices require analyst
              review. They remain ACTIVE until you confirm or resolve.
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 rounded border border-orange-300 bg-orange-100 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-200"
          aria-expanded={expanded}
          aria-controls="material-change-panel"
        >
          {expanded ? "Hide affected \u2191" : "Show affected \u2193"}
        </button>
      </div>

      {/* Expandable details table */}
      {expanded && (
        <div
          id="material-change-panel"
          className="mb-5 rounded-lg border border-orange-200 bg-orange-50 px-5 py-3"
        >
          <table className="w-full text-xs" data-testid="material-change-table">
            <thead>
              <tr className="border-b border-orange-100 uppercase tracking-wide text-gray-500">
                <th className="py-2 text-left font-medium">Invoice</th>
                <th className="py-2 text-left font-medium">Party</th>
                <th className="py-2 text-right font-medium">Original amount</th>
                <th className="py-2 text-right font-medium">Current amount</th>
                <th className="py-2 text-right font-medium">Change %</th>
                <th className="py-2 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-orange-100">
              {flags.map((f) => (
                <tr key={f.invoice_id}>
                  <td className="py-1.5 font-mono text-gray-600">{f.invoice_ref}</td>
                  <td className="max-w-[160px] truncate py-1.5 text-gray-700">{f.canonical_name}</td>
                  <td className="py-1.5 text-right">{f.prior_amount}</td>
                  <td className="py-1.5 text-right font-medium text-orange-700">{f.new_amount}</td>
                  <td className="py-1.5 text-right text-orange-700">+{f.delta_pct}%</td>
                  <td className="py-1.5">
                    <Link
                      to={`/invoice/${f.invoice_id}`}
                      className="text-indigo-600 hover:underline"
                    >
                      Review exception
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Exceptions vs follow-ups explainer banner
// ---------------------------------------------------------------------------

const EXPLAINER_DISMISSED_KEY = "s5-explainer-dismissed";

function ExplainerBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(EXPLAINER_DISMISSED_KEY) === "true",
  );

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(EXPLAINER_DISMISSED_KEY, "true");
    setDismissed(true);
  }

  return (
    <Card
      className="mb-4 border-indigo-200 bg-indigo-50 p-4"
      data-testid="s5-explainer-banner"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold text-indigo-900">
            Exceptions vs follow-ups — what's the difference?
          </p>
          <p className="text-xs text-indigo-800">
            <strong>Exception</strong> = structural issue on an invoice (dispute, legal, credit note
            pending, write-off). Tagged with a bucket; auto-resolves on settlement.{" "}
            <strong>Follow-up</strong> = a logged conversation/email/call with a party. Doesn't
            change invoice state.
          </p>
        </div>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss explainer"
          data-testid="s5-explainer-dismiss"
          className="flex-shrink-0 text-indigo-400 hover:text-indigo-700"
        >
          &times;
        </button>
      </div>
    </Card>
  );
}

function statusBadge(status: string) {
  const map: Record<string, "warning" | "success" | "muted"> = {
    ACTIVE: "warning",
    RESOLVED: "success",
    AUTO_RESOLVED: "muted",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Tag modal (create exception on an invoice)
// ---------------------------------------------------------------------------

interface TagModalProps {
  invoiceId: string;
  open: boolean;
  onClose: () => void;
  buckets: ExceptionBucketListResponse | undefined;
}

function TagModal({ invoiceId, open, onClose, buckets }: TagModalProps) {
  const qc = useQueryClient();
  const [bucketCode, setBucketCode] = useState("");
  const [reason, setReason] = useState("");
  const [expectedDate, setExpectedDate] = useState("");

  const create = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api.post(`/invoices/${invoiceId}/exceptions`, {
        bucket_type_code: bucketCode,
        reason,
        expected_resolution_date: expectedDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Tag exception" size="md">
      <div className="space-y-3">
        <Select
          label="Exception type"
          value={bucketCode}
          onChange={(e) => setBucketCode(e.target.value)}
        >
          <option value="">— Select type —</option>
          {(buckets?.items ?? [])
            .filter((b) => b.active)
            .map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
        </Select>
        <Textarea
          label="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Describe why this invoice is flagged"
        />
        <Input
          label="Expected resolution date (optional)"
          type="date"
          value={expectedDate}
          onChange={(e) => setExpectedDate(e.target.value)}
        />
      </div>
      <ModalFooter
        onClose={onClose}
        onConfirm={() => create.mutate()}
        confirmLabel="Tag"
        loading={create.isPending}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Resolve modal
// ---------------------------------------------------------------------------

interface ResolveModalProps {
  exception: ExceptionListRow;
  open: boolean;
  onClose: () => void;
}

function ResolveModal({ exception, open, onClose }: ResolveModalProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const resolve = useMutation<unknown, ApiError>({
    mutationFn: () =>
      api.patch(`/invoices/${exception.invoice_id}/exceptions/${exception.id}`, {
        action: "RESOLVE",
        resolution_note: note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Resolve exception" size="sm">
      <p className="mb-3 text-sm text-slate-700">
        Resolving exception for <strong>{exception.invoice_ref}</strong> (
        {exception.canonical_name})
      </p>
      <Textarea
        label="Resolution note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Briefly describe resolution"
      />
      <ModalFooter
        onClose={onClose}
        onConfirm={() => resolve.mutate()}
        confirmLabel="Resolve"
        loading={resolve.isPending}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function S5ExceptionsPage() {
  const [searchParams] = useSearchParams();
  const snapshotId = searchParams.get("snapshot_id");

  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [bucketFilter, setBucketFilter] = useState("");
  const [tagTarget, setTagTarget] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ExceptionListRow | null>(null);
  const PAGE_SIZE = 25;

  // Fetch snapshot detail (for material-change banner) only when snapshot_id is present
  const { data: snapshotDetail } = useQuery<SnapshotDetailResponse>({
    queryKey: ["snapshot-detail", snapshotId],
    queryFn: () => api.get<SnapshotDetailResponse>(`/snapshots/${snapshotId}`),
    enabled: !!snapshotId,
    staleTime: 60_000,
  });

  const materialFlags: MaterialChangeFlag[] = snapshotDetail?.material_change_flags ?? [];

  const params = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
    ...(entityFilter && { entity_code: entityFilter }),
    ...(statusFilter && { status: statusFilter }),
    ...(bucketFilter && { bucket_type_code: bucketFilter }),
  });

  const { data, isLoading } = useQuery<ExceptionListResponse>({
    queryKey: ["exceptions", page, entityFilter, statusFilter, bucketFilter],
    queryFn: () => api.get<ExceptionListResponse>(`/exceptions?${params}`),
  });

  const { data: buckets } = useQuery<ExceptionBucketListResponse>({
    queryKey: ["exception-buckets"],
    queryFn: () => api.get<ExceptionBucketListResponse>("/admin/exception-buckets"),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-800">Exceptions</h1>
        <p className="text-xs text-slate-500">
          Exceptions are distinct from follow-ups — they flag invoice anomalies for review.
        </p>
      </div>

      {/* Material-change banner (only rendered when flags exist) */}
      {materialFlags.length > 0 && <MaterialChangeBanner flags={materialFlags} />}

      {/* Exceptions vs follow-ups explainer */}
      <ExplainerBanner />

      {/* Per-bucket summary cards */}
      <BucketSummaryCards
        buckets={buckets}
        exceptions={data}
        activeFilter={bucketFilter}
        onFilter={(code) => {
          setBucketFilter(code);
          setPage(1);
        }}
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          label="Entity"
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setPage(1);
          }}
          className="w-32"
        >
          <option value="">All</option>
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </Select>
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="AUTO_RESOLVED">AUTO_RESOLVED</option>
        </Select>
        <Select
          label="Exception type"
          value={bucketFilter}
          onChange={(e) => {
            setBucketFilter(e.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">All types</option>
          {(buckets?.items ?? []).map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </Select>
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
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-left font-medium">Party</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Reason</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Tagged</th>
                <th className="px-3 py-2 text-left font-medium">Res. by</th>
                <th className="px-3 py-2 text-left font-medium">Last follow-up</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.items ?? []).map((ex) => (
                <tr
                  key={ex.id}
                  className={cn(
                    "hover:bg-slate-50",
                    ex.status === "AUTO_RESOLVED" && "opacity-60",
                  )}
                >
                  <td className="px-3 py-2 font-mono text-xs">{ex.invoice_ref}</td>
                  <td className="px-3 py-2 max-w-[140px] truncate font-medium">
                    {ex.canonical_name}
                  </td>
                  <td className="px-3 py-2 text-xs">{ex.entity_code}</td>
                  <td className="px-3 py-2">
                    <Badge variant="info">{ex.bucket_type_code}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-mono text-slate-700">
                    {ex.outstanding_amount != null ? formatINR(ex.outstanding_amount) : "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[180px] text-xs text-slate-600">
                    <span className="truncate block">{ex.reason}</span>
                    {ex.notes_count > 0 && (
                      <Badge variant="neutral" className="mt-0.5">
                        {ex.notes_count} notes
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{statusBadge(ex.status)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatISTDate(ex.tagged_at)}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {ex.expected_resolution_date
                      ? formatISTDate(ex.expected_resolution_date)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500" data-testid={`last-fu-exc-${ex.id}`}>
                    {ex.last_follow_up_date ? (
                      <span className="flex items-center gap-1">
                        {formatISTDate(ex.last_follow_up_date)}
                        <Badge variant="muted">{ex.last_follow_up_channel}</Badge>
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setTagTarget(ex.invoice_id)}
                        data-testid="tag-btn"
                        aria-label="Tag exception"
                      >
                        Tag
                      </Button>
                      {ex.status === "ACTIVE" && (
                        <button
                          onClick={() => setResolveTarget(ex)}
                          className="text-xs text-green-600 hover:underline"
                          aria-label="Resolve exception"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(!data?.items || data.items.length === 0) && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-400">
                    No exceptions matching filters
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

      {/* Resolve modal */}
      {resolveTarget && (
        <ResolveModal
          exception={resolveTarget}
          open={!!resolveTarget}
          onClose={() => setResolveTarget(null)}
        />
      )}

      {/* Tag modal */}
      {tagTarget && (
        <TagModal
          invoiceId={tagTarget}
          open={!!tagTarget}
          onClose={() => setTagTarget(null)}
          buckets={buckets}
        />
      )}
    </div>
  );
}
