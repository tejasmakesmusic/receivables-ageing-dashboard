/**
 * S1 — Upload snapshot
 * Route: /upload   Roles: ANALYST, ADMIN
 *
 * Two-panel branch:
 *   Left card  — "Transactional snapshot" (Tally / Xero)
 *   Right card — "Credit Period master" (CP diff preview before staging)
 */
import { useRef, useState, DragEvent, ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type {
  SnapshotCreateResponse,
  SnapshotListResponse,
  SourceHint,
  CpDiffResponse,
} from "@/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

// Upload branch selection
type UploadBranch = "transactional" | "credit_period";

// Transactional source options (Tally / Xero only)
const TRANSACTIONAL_SOURCE_OPTIONS: { value: SourceHint; label: string }[] = [
  { value: "TALLY", label: "Tally" },
  { value: "XERO", label: "Xero" },
];

function statusBadge(status: string) {
  const map: Record<string, "info" | "success" | "neutral" | "error" | "warning"> = {
    STAGED: "info",
    PUBLISHED: "success",
    DISCARDED: "neutral",
    PARSING: "warning",
  };
  return <Badge variant={map[status] ?? "neutral"}>{status}</Badge>;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      const d = err.detail as Record<string, string> | undefined;
      if (d?.code === "DUPLICATE_FILE") {
        return `Duplicate file — already uploaded as snapshot ${d.existing_snapshot_id?.slice(0, 8)}…`;
      }
    }
    if (err.status === 422) {
      const d = err.detail as Record<string, string> | undefined;
      if (d?.code === "MISSING_PARTITION") {
        return `Missing DB partition for this date. Contact admin to create partition for this quarter.`;
      }
      if (d?.code === "AS_OF_DATE_MISSING") {
        return `As-of date is required for this source type.`;
      }
      if (Array.isArray(err.detail)) {
        return (err.detail as Array<{ msg: string }>).map((e) => e.msg).join("; ");
      }
    }
    const d = err.detail as { detail?: string } | undefined;
    return d?.detail ?? err.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Drop-zone sub-component (reused by both branches)
// ---------------------------------------------------------------------------

function DropZone({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  function onInput(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onFile(f);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop XLSX file here or click to browse"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && ref.current?.click()}
      className={cn(
        "flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors",
        dragging
          ? "border-blue-400 bg-blue-50"
          : file
            ? "border-green-400 bg-green-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400",
      )}
    >
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={onInput}
      />
      {file ? (
        <div className="text-center">
          <p className="text-sm font-medium text-green-700">{file.name}</p>
          <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
        </div>
      ) : (
        <div className="text-center text-slate-500">
          <p className="text-sm">Drop XLSX here or click to browse</p>
          <p className="mt-1 text-xs">.xlsx / .xls accepted</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CP diff panel
// ---------------------------------------------------------------------------

function CpDiffPanel({ snapshotId }: { snapshotId: string }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery<CpDiffResponse, ApiError>({
    queryKey: ["cp-diff", snapshotId],
    queryFn: () => api.get<CpDiffResponse>(`/snapshots/${snapshotId}/cp-diff`),
    enabled: open,
  });

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-blue-600 hover:underline"
        aria-expanded={open}
        data-testid="cp-diff-toggle"
      >
        {open ? "Hide config diff ▲" : "View config diff ▼"}
      </button>

      {open && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-3 text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Config diff preview
          </p>

          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600">Failed to load diff: {errorMessage(error)}</p>
          )}

          {data && (
            <div className="space-y-4">
              {/* ADDED */}
              {data.added.length > 0 && (
                <DiffSection
                  title={`Added (${data.added.length})`}
                  badgeVariant="success"
                  rows={data.added}
                  showPrior={false}
                />
              )}

              {/* SUPERSEDED */}
              {data.superseded.length > 0 && (
                <DiffSection
                  title={`Superseded (${data.superseded.length})`}
                  badgeVariant="warning"
                  rows={data.superseded}
                  showPrior={true}
                />
              )}

              {/* UNCHANGED */}
              {data.unchanged.length > 0 && (
                <DiffSection
                  title={`Unchanged (${data.unchanged.length})`}
                  badgeVariant="neutral"
                  rows={data.unchanged}
                  showPrior={false}
                />
              )}

              {data.added.length === 0 &&
                data.superseded.length === 0 &&
                data.unchanged.length === 0 && (
                  <p className="text-sm text-slate-400 italic">No CP rows found in snapshot.</p>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffSection({
  title,
  badgeVariant,
  rows,
  showPrior,
}: {
  title: string;
  badgeVariant: "success" | "warning" | "neutral";
  rows: CpDiffResponse["added"];
  showPrior: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Badge variant={badgeVariant}>{title}</Badge>
      </div>
      <div className="overflow-x-auto rounded border border-gray-100">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Client</th>
              <th className="px-3 py-1.5 text-left font-medium">Entity</th>
              <th className="px-3 py-1.5 text-left font-medium">Days</th>
              {showPrior && (
                <th className="px-3 py-1.5 text-left font-medium">Prior days</th>
              )}
              <th className="px-3 py-1.5 text-left font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-3 py-1.5">{r.canonical_name}</td>
                <td className="px-3 py-1.5">{r.entity_code}</td>
                <td className="px-3 py-1.5 font-medium">{r.days}</td>
                {showPrior && (
                  <td className="px-3 py-1.5 text-slate-400">{r.prior_days ?? "—"}</td>
                )}
                <td className="px-3 py-1.5 text-slate-500">{r.reason_note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload success card (shared)
// ---------------------------------------------------------------------------

function UploadSuccessCard({
  uploadResult,
  isCreditPeriod,
}: {
  uploadResult: SnapshotCreateResponse;
  isCreditPeriod: boolean;
}) {
  return (
    <Card className="mt-4 border-green-200 bg-green-50">
      <CardHeader>
        <CardTitle className="text-green-800">Upload successful</CardTitle>
      </CardHeader>
      <div className="space-y-1 text-sm text-slate-700">
        <div>
          Snapshot ID:{" "}
          <Link
            to={`/staging/${uploadResult.snapshot_id}`}
            className="font-mono text-blue-600 hover:underline"
          >
            {uploadResult.snapshot_id.slice(0, 8)}…
          </Link>
        </div>
        <div>
          Source: <strong>{uploadResult.source_hint}</strong>
        </div>
        {uploadResult.as_of_date && (
          <div>
            As-of: <strong>{uploadResult.as_of_date}</strong>
          </div>
        )}
        <div>
          Invoices parsed:{" "}
          <strong>{uploadResult.parse_summary.invoices_parsed}</strong>
          {uploadResult.parse_summary.parse_error_count > 0 && (
            <span className="ml-2 text-red-600">
              ({uploadResult.parse_summary.parse_error_count} parse errors)
            </span>
          )}
        </div>
        {uploadResult.parse_summary.warnings.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-medium text-yellow-700">
              Warnings ({uploadResult.parse_summary.warnings.length}):
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {uploadResult.parse_summary.warnings.map((w, i) => (
                <li key={i} className="text-xs text-yellow-700">
                  <strong>{w.code}</strong>: {w.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-2 text-xs text-slate-500">
          SHA-256: <span className="font-mono">{uploadResult.file_sha256.slice(0, 16)}…</span>
        </div>
      </div>

      {/* CP diff preview inline in success card */}
      {isCreditPeriod && <CpDiffPanel snapshotId={uploadResult.snapshot_id} />}

      <div className="mt-3">
        <Link to={`/staging/${uploadResult.snapshot_id}`}>
          <Button variant="primary" size="sm">
            {isCreditPeriod ? "Review CP rows in Staging →" : "Review in Staging →"}
          </Button>
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function S1UploadPage() {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const entity = searchParams.get("entity") ?? "IND";

  // Branch selection
  const [branch, setBranch] = useState<UploadBranch>("transactional");

  // Transactional form state
  const [sourceHint, setSourceHint] = useState<SourceHint>("TALLY");
  const [asOfDate, setAsOfDate] = useState("");
  const [txFile, setTxFile] = useState<File | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<SnapshotCreateResponse | null>(null);

  // CP form state
  const [cpFile, setCpFile] = useState<File | null>(null);
  const [cpError, setCpError] = useState<string | null>(null);
  const [cpResult, setCpResult] = useState<SnapshotCreateResponse | null>(null);

  // Recent snapshots list
  const { data: snapshotsData, isLoading: loadingSnapshots } = useQuery<SnapshotListResponse>({
    queryKey: ["snapshots", entity],
    queryFn: () => api.get<SnapshotListResponse>(`/snapshots?entity_code=${entity}&page=1&page_size=10`),
  });

  // Shared upload mutation
  const upload = useMutation<SnapshotCreateResponse, ApiError, FormData>({
    mutationFn: (fd) => api.post<SnapshotCreateResponse>("/snapshots", fd),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["snapshots"] });
      if (branch === "transactional") {
        setTxResult(res);
        setTxError(null);
      } else {
        setCpResult(res);
        setCpError(null);
      }
    },
    onError: (err) => {
      if (branch === "transactional") {
        setTxError(errorMessage(err));
        setTxResult(null);
      } else {
        setCpError(errorMessage(err));
        setCpResult(null);
      }
    },
  });

  function handleTxUpload() {
    if (!txFile) return;
    const fd = new FormData();
    fd.append("file", txFile);
    fd.append("entity_code", entity);
    fd.append("source_hint", sourceHint);
    if (asOfDate) fd.append("as_of_date", asOfDate);
    upload.mutate(fd);
  }

  function handleCpUpload() {
    if (!cpFile) return;
    const fd = new FormData();
    fd.append("file", cpFile);
    fd.append("entity_code", entity);
    fd.append("source_hint", "CREDIT_PERIOD");
    upload.mutate(fd);
  }

  function selectBranch(b: UploadBranch) {
    setBranch(b);
    // Reset results when switching branches so stale success cards don't show
    setTxResult(null);
    setTxError(null);
    setCpResult(null);
    setCpError(null);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Upload Snapshot</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        Entity: <strong>{entity}</strong>
      </p>

      {/* ----------------------------------------------------------------- */}
      {/* Branch selector — two cards side-by-side                           */}
      {/* ----------------------------------------------------------------- */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {/* Left: Transactional */}
        <button
          type="button"
          onClick={() => selectBranch("transactional")}
          data-testid="branch-transactional"
          className={cn(
            "rounded-lg border-2 p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
            branch === "transactional"
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 bg-white hover:border-gray-300",
          )}
        >
          <p className={cn("text-sm font-semibold", branch === "transactional" ? "text-blue-700" : "text-slate-700")}>
            Transactional snapshot
          </p>
          <p className="mt-1 text-xs text-slate-500">Tally or Xero AR export</p>
        </button>

        {/* Right: Credit Period master */}
        <button
          type="button"
          onClick={() => selectBranch("credit_period")}
          data-testid="branch-credit-period"
          className={cn(
            "rounded-lg border-2 p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
            branch === "credit_period"
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 bg-white hover:border-gray-300",
          )}
        >
          <p className={cn("text-sm font-semibold", branch === "credit_period" ? "text-blue-700" : "text-slate-700")}>
            Credit Period master
          </p>
          <p className="mt-1 text-xs text-slate-500">India + UAE CP master XLSX</p>
        </button>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Transactional form                                                  */}
      {/* ----------------------------------------------------------------- */}
      {branch === "transactional" && (
        <Card className="mt-4">
          <div className="flex flex-col gap-4">
            <Select
              label="Source type"
              value={sourceHint}
              onChange={(e) => setSourceHint(e.target.value as SourceHint)}
            >
              {TRANSACTIONAL_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>

            <div className="flex flex-col gap-1">
              <label htmlFor="as-of-date" className="text-xs font-medium text-slate-600">
                As-of date{sourceHint === "TALLY" ? " (required)" : " (optional — sniffed from file)"}
              </label>
              <input
                id="as-of-date"
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>

            <DropZone file={txFile} onFile={(f) => { setTxFile(f); setTxError(null); setTxResult(null); }} />

            {txError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {txError}
              </div>
            )}

            <Button
              variant="primary"
              size="md"
              disabled={!txFile}
              loading={upload.isPending && branch === "transactional"}
              onClick={handleTxUpload}
            >
              Upload
            </Button>
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Credit Period form                                                  */}
      {/* ----------------------------------------------------------------- */}
      {branch === "credit_period" && (
        <Card className="mt-4">
          <div className="flex flex-col gap-4">
            <p className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Credit period master expects sheets named <strong>India</strong> and{" "}
              <strong>UAE</strong> in one XLSX. Covers both entities — no entity or as-of
              date selection required (defaults to today if absent).
            </p>

            <DropZone file={cpFile} onFile={(f) => { setCpFile(f); setCpError(null); setCpResult(null); }} />

            {cpError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {cpError}
              </div>
            )}

            <Button
              variant="primary"
              size="md"
              disabled={!cpFile}
              loading={upload.isPending && branch === "credit_period"}
              onClick={handleCpUpload}
            >
              Parse &amp; preview diff
            </Button>
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Success cards (per branch)                                          */}
      {/* ----------------------------------------------------------------- */}
      {branch === "transactional" && txResult && (
        <UploadSuccessCard uploadResult={txResult} isCreditPeriod={false} />
      )}

      {branch === "credit_period" && cpResult && (
        <UploadSuccessCard uploadResult={cpResult} isCreditPeriod={true} />
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Recent snapshots                                                    */}
      {/* ----------------------------------------------------------------- */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent uploads</h2>
        {loadingSnapshots ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">ID</th>
                  <th className="px-3 py-2 text-left font-medium">Entity</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-left font-medium">As-of</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Uploaded</th>
                  <th className="px-3 py-2 text-left font-medium">Uploaded by</th>
                  <th className="px-3 py-2 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(snapshotsData?.items ?? []).map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">
                      {row.id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2">{row.entity_code}</td>
                    <td className="px-3 py-2">{row.source_hint}</td>
                    <td className="px-3 py-2">{row.as_of_date ?? "—"}</td>
                    <td className="px-3 py-2">{statusBadge(row.status)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {formatISTDate(row.uploaded_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.uploaded_by_email ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "STAGED" && (
                        <Link
                          to={`/snapshots/${row.id}/staging`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {row.source_hint === "CREDIT_PERIOD"
                            ? "View config diff →"
                            : "Review →"}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {(!snapshotsData?.items || snapshotsData.items.length === 0) && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-xs text-slate-400">
                      No snapshots yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
