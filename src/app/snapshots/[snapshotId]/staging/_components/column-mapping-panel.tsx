"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, History, ScanLine } from "lucide-react";

type Confidence = "EXACT" | "HEURISTIC" | "MISSING";

export interface ColumnMappingViewModel {
  source_hint: string;
  layout_variant: string;
  fields: Record<string, { source: string | null; confidence: Confidence }>;
}

const CONFIDENCE_TONE: Record<Confidence, string> = {
  EXACT:
    "bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]",
  HEURISTIC:
    "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]",
  MISSING:
    "bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]",
};

/**
 * PR 8a — staging "Column Mapping" panel. Shows what the parser captured,
 * highlights drift vs. the saved default, and exposes a "Save as default"
 * action that persists the captured mapping for next upload.
 *
 * Note: this PR does NOT yet reparse with overrides — the parser-refactor
 * piece is PR 8b.
 */
export function ColumnMappingPanel({
  entity,
  sourceHint,
  detected,
  saved,
  drift,
}: {
  entity: "IND" | "UAE";
  sourceHint: string;
  detected: ColumnMappingViewModel | null;
  saved: ColumnMappingViewModel | null;
  drift: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "saved">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  if (!detected) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-text-muted)]">
        No column mapping was captured for this snapshot.
      </div>
    );
  }

  async function handleSaveDefault() {
    if (!detected) return;
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch("/api/column-mappings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          source_hint: sourceHint,
          mapping: detected,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(
          payload?.message ?? `Save failed with ${response.status}`,
        );
      }
      setStatus("saved");
      setMessage("Saved as default for next upload.");
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Save failed");
    }
  }

  const fieldKeys = Object.keys(detected.fields);
  const hasDrift = drift.length > 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-[var(--color-text-muted)]" />
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              Column Mapping · {detected.layout_variant}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              {hasDrift
                ? `Drift detected vs. saved default (${drift.length} field${drift.length === 1 ? "" : "s"})`
                : saved
                  ? "Matches saved default for this entity + source"
                  : "No saved default yet — review and save"}
            </div>
          </div>
        </div>
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-60"
          disabled={status === "saving" || isPending}
          onClick={handleSaveDefault}
          type="button"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {status === "saving" ? "Saving…" : "Save as default"}
        </button>
      </div>

      {hasDrift ? (
        <div className="border-b border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-4 py-2 text-xs text-[var(--color-status-warning-text)]">
          <div className="font-semibold">
            <History className="inline h-3 w-3" /> Drift vs. saved default:
          </div>
          <ul className="mt-1 list-disc pl-4">
            {drift.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-1 p-4 text-sm">
        {fieldKeys.map((field) => {
          const f = detected.fields[field];
          const savedF = saved?.fields[field];
          return (
            <div
              className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[var(--color-bg-subtle)]"
              key={field}
            >
              <span className="font-mono text-xs text-[var(--color-text-muted)]">
                {field}
              </span>
              <span className="text-xs text-[var(--color-text-subtle)]">
                ←
              </span>
              <span className="font-mono text-xs text-[var(--color-text)]">
                {f.source ?? <em>(missing)</em>}
                {savedF && savedF.source !== f.source ? (
                  <span className="ml-2 text-[var(--color-status-warning-text)]">
                    (saved: {savedF.source ?? "(missing)"})
                  </span>
                ) : null}
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CONFIDENCE_TONE[f.confidence]}`}
              >
                {f.confidence}
              </span>
            </div>
          );
        })}
      </div>

      {message ? (
        <p
          aria-live="polite"
          className={`border-t border-[var(--color-border)] px-4 py-2 text-xs ${
            status === "error"
              ? "text-[var(--color-status-danger-text)]"
              : "text-[var(--color-status-current-text)]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
