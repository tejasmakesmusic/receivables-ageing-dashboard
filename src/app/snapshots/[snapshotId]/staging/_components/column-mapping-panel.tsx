"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, History, ScanLine } from "lucide-react";
import { useToast } from "@/components/ui/toast";

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
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "saved">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  // PR B — collapse the per-field grid by default when all fields are EXACT
  // and there's no drift. Hooks must be declared before any early return,
  // so we compute the initial value from the prop directly.
  const allExactInit =
    !!detected &&
    Object.values(detected.fields).every((f) => f.confidence === "EXACT") &&
    drift.length === 0;
  const [expanded, setExpanded] = useState(!allExactInit);

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
      toast.success("Column mapping saved as default for next upload.");
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Save failed";
      setMessage(msg);
      toast.error(msg);
    }
  }

  const fieldKeys = Object.keys(detected.fields);
  const hasDrift = drift.length > 0;
  const allExact = fieldKeys.every(
    (k) => detected.fields[k].confidence === "EXACT",
  );

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

      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)]"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <span>
            {allExact
              ? `${fieldKeys.length} fields · all exact match`
              : `${fieldKeys.length} fields`}
          </span>
        </span>
        <span className="text-[var(--color-text-subtle)]">
          {expanded ? "Hide" : "Show"} field map
        </span>
      </button>

      {expanded ? (
        <div className="grid gap-1 px-4 pb-4 text-sm sm:grid-cols-2">
          {fieldKeys.map((field) => {
            const f = detected.fields[field];
            const savedF = saved?.fields[field];
            return (
              <div
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 hover:bg-[var(--color-bg-subtle)]"
                key={field}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px] text-[var(--color-text-muted)]">
                    {field}
                  </span>
                  <span className="block truncate font-mono text-xs text-[var(--color-text)]">
                    {f.source ?? <em>(missing)</em>}
                  </span>
                  {savedF && savedF.source !== f.source ? (
                    <span className="block truncate text-[10px] text-[var(--color-status-warning-text)]">
                      was: {savedF.source ?? "(missing)"}
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
      ) : null}

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
