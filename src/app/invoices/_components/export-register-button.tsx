"use client";

import { useState } from "react";
import { Download } from "lucide-react";

type ExportStatus = "idle" | "downloading" | "error";

function fileNameFromDisposition(value: string | null) {
  const match = value?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? "ageing-register.xlsx";
}

export function ExportRegisterButton({
  entity,
  status,
}: {
  entity?: string;
  status?: string;
}) {
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setExportStatus("downloading");
    setMessage("");

    try {
      const url = new URL("/api/reports/ageing", window.location.origin);
      if (entity === "IND" || entity === "UAE") {
        url.searchParams.set("entity", entity);
      }
      if (status === "OPEN" || status === "SETTLED") {
        url.searchParams.set("status", status);
      }

      const response = await fetch(url);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        throw new Error(
          payload?.message ??
            payload?.error ??
            `Export failed with ${response.status}`,
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileNameFromDisposition(
        response.headers.get("content-disposition"),
      );
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setExportStatus("idle");
    } catch (error) {
      setExportStatus("error");
      setMessage(error instanceof Error ? error.message : "Export failed");
    }
  }

  return (
    <div className="grid gap-1">
      <button
        className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)] disabled:pointer-events-none disabled:opacity-60"
        disabled={exportStatus === "downloading"}
        onClick={handleClick}
        type="button"
      >
        <Download className="h-4 w-4" />
        {exportStatus === "downloading" ? "Exporting..." : "Export Register"}
      </button>
      {message ? (
        <span aria-live="polite" className="text-xs text-red-700">
          {message}
        </span>
      ) : null}
    </div>
  );
}
