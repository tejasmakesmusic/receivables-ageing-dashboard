"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import type {
  StagingCreditPeriodRow,
  StagingInvoiceRow,
} from "@/server/snapshots/service";

type StagingRow = StagingInvoiceRow | StagingCreditPeriodRow;

function isInvoiceRow(row: StagingRow): row is StagingInvoiceRow {
  return "party_name_raw" in row;
}

function rowName(row: StagingRow) {
  return isInvoiceRow(row) ? row.party_name_raw : row.name;
}

export function StagingRowActions({
  row,
  snapshotId,
}: {
  row: StagingRow;
  snapshotId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");

  const isInvoice = isInvoiceRow(row);
  const isResolved = Boolean(row.analyst_overrides.resolved_canonical_id);
  const resolutionState = isInvoice ? row.alias_resolution.resolutionState : "OK";
  const candidate = isInvoice ? row.alias_resolution.topMatches[0] : null;

  async function patchRow(body: Record<string, unknown>) {
    setState("submitting");
    setMessage("");
    try {
      const res = await fetch(
        `/api/snapshots/${snapshotId}/staging/${row.row_index}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(
          err?.message ?? err?.error ?? `Request failed ${res.status}`,
        );
      }
      router.refresh();
      setState("idle");
    } catch (err) {
      setState("error");
      setMessage(
        err instanceof Error ? err.message : "Could not update staging row",
      );
    }
  }

  // Analyst override applied — Match column already shows "Resolved", so the
  // Action column would just echo it. Render a tiny dash so the column isn't
  // empty visually, but no duplicated status text.
  if (isResolved) {
    return (
      <span className="text-xs text-[var(--color-text-subtle)]">—</span>
    );
  }

  // Credit period row or exact auto-match — no action needed. The Match
  // column already shows "Auto-matched"; don't duplicate it here.
  if (!isInvoice || resolutionState === "EXACT") {
    return (
      <span className="text-xs text-[var(--color-text-subtle)]">—</span>
    );
  }

  // Parse error row
  if (row.status === "PARSE_ERROR") {
    if (row.analyst_overrides.dismissed) {
      // Match column already shows "Reviewed" — no duplication needed.
      return (
        <span className="text-xs text-[var(--color-text-subtle)]">—</span>
      );
    }
    return (
      <div className="space-y-1.5">
        {row.parse_error_reason ? (
          <p className="max-w-[200px] text-xs text-[var(--color-status-danger-text)]">
            {row.parse_error_reason}
          </p>
        ) : null}
        <button
          className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-2.5 text-xs font-medium text-[var(--color-status-warning-text)] hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
          disabled={state === "submitting"}
          onClick={() =>
            patchRow({
              action: "dismiss_parse_error",
              reason: "Reviewed from staging UI",
            })
          }
          type="button"
        >
          {state === "submitting" ? "Saving…" : "Mark Reviewed"}
        </button>
        {message ? (
          <p className="text-xs text-[var(--color-status-danger-text)]">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  // Fuzzy high — candidate likely correct, accent-colored accept button
  // Fuzzy low / unmapped — candidate uncertain or absent, create new is primary
  const isFuzzyHigh = resolutionState === "FUZZY_HIGH";

  return (
    <div className="space-y-1">
      {candidate ? (
        <button
          className={[
            "inline-flex h-7 w-full max-w-[220px] items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium disabled:pointer-events-none disabled:opacity-50",
            isFuzzyHigh
              ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
              : "border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)] hover:opacity-80",
          ].join(" ")}
          disabled={state === "submitting"}
          onClick={() =>
            patchRow({
              action: "resolve_alias",
              canonical_id: candidate.canonicalId,
              create_alias: true,
            })
          }
          title={`Accept: ${candidate.canonicalName} (${candidate.ratio.toFixed(0)}% confidence)`}
          type="button"
        >
          <Check className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">{candidate.canonicalName}</span>
          <span className="ml-auto shrink-0 tabular-nums opacity-70">
            {candidate.ratio.toFixed(0)}%
          </span>
        </button>
      ) : null}
      <button
        className={[
          "inline-flex h-7 w-full max-w-[220px] items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium disabled:pointer-events-none disabled:opacity-50",
          !candidate || !isFuzzyHigh
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
        ].join(" ")}
        disabled={state === "submitting"}
        onClick={() =>
          patchRow({
            action: "create_canonical",
            canonical_name: rowName(row),
            ...(isInvoice && (row as StagingInvoiceRow).gstin
              ? { gstin: (row as StagingInvoiceRow).gstin! }
              : {}),
            ...(isInvoice && (row as StagingInvoiceRow).xero_contact_id
              ? { xero_contact_id: (row as StagingInvoiceRow).xero_contact_id! }
              : {}),
          })
        }
        type="button"
      >
        <Plus className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">Create New</span>
      </button>
      {message ? (
        <p className="text-xs text-[var(--color-status-danger-text)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
