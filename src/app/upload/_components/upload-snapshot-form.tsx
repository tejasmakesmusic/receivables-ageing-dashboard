"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DsButton,
  DsDatePicker,
  DsFileDropzone,
  DsSelect,
} from "../../../../design-system/components";

type UploadStatus = "idle" | "submitting" | "error";

type UploadResponse = {
  code?: string;
  message?: string;
  snapshot_id?: string;
};

export function UploadSnapshotForm() {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [message, setMessage] = useState("");
  const [entityCode, setEntityCode] = useState("IND");
  const [sourceHint, setSourceHint] = useState("");
  const [asOfDate, setAsOfDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const uiV2 = process.env.NEXT_PUBLIC_UI_V2 === "true";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus("submitting");
    setMessage("");

    const body = new FormData(event.currentTarget);

    if (uiV2) {
      if (!file) {
        setStatus("error");
        setMessage("Drop a workbook before uploading the snapshot.");
        return;
      }

      body.set("entity_code", entityCode);
      body.set("source_hint", sourceHint);
      if (asOfDate) body.set("as_of_date", asOfDate);
      body.set("file", file);
    }

    const response = await fetch("/api/snapshots/upload", {
      method: "POST",
      body,
    });
    const payload = (await response.json().catch(() => null)) as
      | UploadResponse
      | { success: false; error?: { code?: string; message?: string } }
      | null;

    if (!response.ok || !payload || !("snapshot_id" in payload) || !payload.snapshot_id) {
      setStatus("error");
      const message =
        (payload && "message" in payload && payload.message) ||
        (payload && "error" in payload && payload.error?.message) ||
        "Upload failed. Check the workbook, entity, and as-of date.";
      setMessage(message);
      return;
    }

    router.push(`/snapshots/${payload.snapshot_id}/staging`);
    router.refresh();
  }

  if (uiV2) {
    return (
      <form className="grid gap-5 text-sm" onSubmit={handleSubmit}>
        <div className="grid gap-4 lg:grid-cols-2">
          <DsSelect
            disabled={status === "submitting"}
            label="Entity"
            name="entity_code"
            onChange={setEntityCode}
            options={[
              { label: "India · Tally", value: "IND" },
              { label: "UAE · Xero", value: "UAE" },
            ]}
            value={entityCode}
          />
          <DsSelect
            disabled={status === "submitting"}
            label="Source"
            name="source_hint"
            onChange={setSourceHint}
            options={[
              { label: "Auto-detect", value: "" },
              { label: "Tally", value: "TALLY" },
              { label: "Xero", value: "XERO" },
              { label: "Credit Period", value: "CREDIT_PERIOD" },
            ]}
            value={sourceHint}
          />
        </div>

        <div className="grid gap-2">
          <DsDatePicker
            disabled={status === "submitting"}
            label="As-of date"
            name="as_of_date"
            onChange={setAsOfDate}
            value={asOfDate}
          />
          <span className="text-[12px] leading-4 text-[var(--color-text-muted)]">
            Required for Tally snapshots. Xero can usually detect this from the workbook.
          </span>
        </div>

        <DsFileDropzone
          disabled={status === "submitting"}
          file={file}
          onFile={setFile}
        />

        <div className="flex flex-wrap items-center gap-3">
          <DsButton disabled={status === "submitting"} loading={status === "submitting"} type="submit">
            {status === "submitting" ? "Uploading snapshot..." : "Upload snapshot"}
          </DsButton>
          <span className="text-[12px] text-[var(--color-text-muted)]">
            Publish remains gated until staging blockers are resolved.
          </span>
        </div>
        {message ? (
          <p aria-live="polite" className="text-sm text-[var(--color-danger)]">
            {message}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <form className="grid gap-4 text-sm" onSubmit={handleSubmit}>
      <label className="grid gap-1">
        <span className="font-medium">Entity</span>
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          disabled={status === "submitting"}
          name="entity_code"
          onChange={(event) => setEntityCode(event.target.value)}
          required
          value={entityCode}
        >
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-medium">Source</span>
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          disabled={status === "submitting"}
          name="source_hint"
        >
          <option value="">Auto-detect</option>
          <option value="TALLY">TALLY</option>
          <option value="XERO">XERO</option>
          <option value="CREDIT_PERIOD">CREDIT_PERIOD</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-medium">As-of date</span>
        <input
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          disabled={status === "submitting"}
          name="as_of_date"
          type="date"
        />
      </label>
      <label className="grid gap-1">
        <span className="font-medium">XLSX file</span>
        <input
          accept=".xlsx,.xls"
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          disabled={status === "submitting"}
          name="file"
          required
          type="file"
        />
      </label>
      <button
        className="w-fit rounded bg-[var(--color-accent)] px-4 py-2 text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-60"
        disabled={status === "submitting"}
        type="submit"
      >
        {status === "submitting" ? "Uploading..." : "Upload"}
      </button>
      {message ? (
        <p aria-live="polite" className="text-sm text-[var(--color-danger)]">
          {message}
        </p>
      ) : null}
    </form>
  );
}
