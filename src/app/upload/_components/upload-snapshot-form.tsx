"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setStatus("submitting");
    setMessage("");

    const response = await fetch("/api/snapshots", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    const payload = (await response.json().catch(() => null)) as
      | UploadResponse
      | null;

    if (!response.ok || !payload?.snapshot_id) {
      setStatus("error");
      setMessage(
        payload?.message ??
          "Upload failed. Check the workbook, entity, and as-of date.",
      );
      return;
    }

    router.push(`/snapshots/${payload.snapshot_id}/staging`);
    router.refresh();
  }

  return (
    <form className="grid gap-4 text-sm" onSubmit={handleSubmit}>
      <label className="grid gap-1">
        <span className="font-medium">Entity</span>
        <select
          className="rounded border border-slate-200 bg-white px-3 py-2"
          disabled={status === "submitting"}
          name="entity_code"
          required
        >
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-medium">Source</span>
        <select
          className="rounded border border-slate-200 bg-white px-3 py-2"
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
          className="rounded border border-slate-200 bg-white px-3 py-2"
          disabled={status === "submitting"}
          name="as_of_date"
          type="date"
        />
      </label>
      <label className="grid gap-1">
        <span className="font-medium">XLSX file</span>
        <input
          accept=".xlsx,.xls"
          className="rounded border border-slate-200 bg-white px-3 py-2"
          disabled={status === "submitting"}
          name="file"
          required
          type="file"
        />
      </label>
      <button
        className="w-fit rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-60"
        disabled={status === "submitting"}
        type="submit"
      >
        {status === "submitting" ? "Uploading..." : "Upload"}
      </button>
      {message ? (
        <p aria-live="polite" className="text-sm text-red-700">
          {message}
        </p>
      ) : null}
    </form>
  );
}
