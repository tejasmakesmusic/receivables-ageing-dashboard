/**
 * S1 — Upload snapshot
 * Route: /upload   Roles: ANALYST, ADMIN
 */
import { useRef, useState, DragEvent, ChangeEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import type { SnapshotCreateResponse, SnapshotListResponse, SourceHint } from "@/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatISTDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";

const SOURCE_OPTIONS: { value: SourceHint; label: string }[] = [
  { value: "TALLY", label: "Tally" },
  { value: "XERO", label: "Xero" },
  { value: "CREDIT_PERIOD", label: "Credit Period master" },
];

function statusBadge(status: string) {
  const map: Record<string, "info" | "success" | "neutral" | "error"> = {
    STAGED: "info",
    PUBLISHED: "success",
    DISCARDED: "neutral",
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
      // pydantic 422 array
      if (Array.isArray(err.detail)) {
        return (err.detail as Array<{ msg: string }>).map((e) => e.msg).join("; ");
      }
    }
    const d = err.detail as { detail?: string } | undefined;
    return d?.detail ?? err.message;
  }
  return String(err);
}

export function S1UploadPage() {
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();

  const entity = searchParams.get("entity") ?? "IND";
  const [sourceHint, setSourceHint] = useState<SourceHint>("TALLY");
  const [asOfDate, setAsOfDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<SnapshotCreateResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isCreditPeriod = sourceHint === "CREDIT_PERIOD";

  // Recent snapshots list
  const { data: snapshotsData, isLoading: loadingSnapshots } = useQuery<SnapshotListResponse>({
    queryKey: ["snapshots", entity],
    queryFn: () => api.get<SnapshotListResponse>(`/snapshots?entity_code=${entity}&page=1&page_size=10`),
  });

  const upload = useMutation<SnapshotCreateResponse, ApiError, FormData>({
    mutationFn: (fd) => api.post<SnapshotCreateResponse>("/snapshots", fd),
    onSuccess: (res) => {
      setUploadResult(res);
      setUploadError(null);
      qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
    onError: (err) => {
      setUploadError(errorMessage(err));
      setUploadResult(null);
    },
  });

  function pickFile(f: File) {
    setFile(f);
    setUploadError(null);
    setUploadResult(null);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) pickFile(f);
  }

  function handleUpload() {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entity_code", isCreditPeriod ? entity : entity);
    fd.append("source_hint", sourceHint);
    if (!isCreditPeriod && asOfDate) {
      fd.append("as_of_date", asOfDate);
    }
    upload.mutate(fd);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-800">Upload Snapshot</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        Entity: <strong>{entity}</strong>
      </p>

      <Card className="mt-4">
        <div className="flex flex-col gap-4">
          {/* Source selector */}
          <Select
            label="Source type"
            value={sourceHint}
            onChange={(e) => setSourceHint(e.target.value as SourceHint)}
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          {/* As-of date — required for Tally, optional for Xero, hidden for Credit Period */}
          {!isCreditPeriod && (
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
          )}

          {isCreditPeriod && (
            <p className="rounded bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Credit period master expects sheets named <strong>India</strong> and <strong>UAE</strong>{" "}
              in one XLSX. No as-of date or entity selection required — covers both entities.
            </p>
          )}

          {/* Drop zone */}
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
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
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
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onFileInput}
            />
            {file ? (
              <div className="text-center">
                <p className="text-sm font-medium text-green-700">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div className="text-center text-slate-500">
                <p className="text-sm">Drop XLSX here or click to browse</p>
                <p className="mt-1 text-xs">.xlsx / .xls accepted</p>
              </div>
            )}
          </div>

          {/* Error */}
          {uploadError && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {uploadError}
            </div>
          )}

          {/* Upload button */}
          <Button
            variant="primary"
            size="md"
            disabled={!file}
            loading={upload.isPending}
            onClick={handleUpload}
          >
            Upload
          </Button>
        </div>
      </Card>

      {/* Success / parse report */}
      {uploadResult && (
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
          <div className="mt-3">
            <Link to={`/staging/${uploadResult.snapshot_id}`}>
              <Button variant="primary" size="sm">
                Review in Staging →
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Recent snapshots */}
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
                    <td className="px-3 py-2">
                      {row.status === "STAGED" && (
                        <Link
                          to={`/staging/${row.id}`}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Review →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {(!snapshotsData?.items || snapshotsData.items.length === 0) && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-400">
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
