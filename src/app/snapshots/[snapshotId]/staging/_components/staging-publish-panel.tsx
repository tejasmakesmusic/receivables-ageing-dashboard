"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import type { PublishGate } from "@/server/snapshots/service";

// PR B — drop the previous useState(publishGate) local copy. It diverged from
// server state after router.refresh() because useState only initialises on
// mount, leaving the publish button disabled even when the server's gate
// said OK. Trust the prop; the server is the source of truth.

type ActionState =
  | "idle"
  | "acknowledging"
  | "publishing"
  | "dismissing"
  | "error";

type ApiError = {
  error?: string;
  message?: string;
};

// Kept for typing the warnings-ack response. We no longer copy the returned
// gate into local state — router.refresh() re-renders with the fresh prop.
type WarningsAckResponse = {
  publish_gate: PublishGate;
};

function GateBlockerItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 py-2 text-sm text-[var(--color-status-danger-text)]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </div>
  );
}

export function StagingPublishPanel({
  publishGate,
  snapshotId,
  sourceHint,
  parseErrorRowIndices = [],
}: {
  publishGate: PublishGate;
  snapshotId: string;
  sourceHint: string;
  /** PR B — when set, enables a bulk "Dismiss all parse errors" action. */
  parseErrorRowIndices?: number[];
}) {
  const router = useRouter();
  // Single source of truth: the server-rendered prop. Local copy used to
  // diverge after router.refresh() and stranded the publish button as
  // disabled even when the gate had cleared. See note at top of file.
  const gate = publishGate;
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");

  const warningCodes = gate.warnings_unacknowledged;
  const hasWarnings = warningCodes.length > 0;
  const canPublish = gate.ok && state !== "publishing";
  const hasParseErrorsToBulkDismiss = parseErrorRowIndices.length > 0;
  const publishLabel =
    sourceHint === "CREDIT_PERIOD" ? "Publish Credit Periods" : "Publish Snapshot";

  async function readError(response: Response) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    return (
      payload?.message ?? payload?.error ?? `Request failed with ${response.status}`
    );
  }

  async function acknowledgeWarnings() {
    if (!hasWarnings) return;
    setState("acknowledging");
    setMessage("");
    try {
      const response = await fetch(
        `/api/snapshots/${snapshotId}/warnings/ack`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codes: warningCodes }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      // Drain the body for typing; we don't mutate local state because
      // router.refresh() reseeds the prop with the fresh gate.
      (await response.json()) as WarningsAckResponse;
      setState("idle");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Could not acknowledge warnings",
      );
    }
  }

  // PR B — bulk-dismiss every undismissed parse-error row. Runs the per-row
  // PATCHes SEQUENTIALLY: patchStagingRow does read-modify-write on the
  // snapshot's staging_overrides_json, so parallel requests race each other
  // and only the last write survives. Sequential is slower but correct.
  async function dismissAllParseErrors() {
    if (parseErrorRowIndices.length === 0) return;
    setState("dismissing");
    setMessage("");
    let done = 0;
    try {
      for (const rowIndex of parseErrorRowIndices) {
        const res = await fetch(
          `/api/snapshots/${snapshotId}/staging/${rowIndex}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "dismiss_parse_error",
              reason: "Bulk-reviewed from staging gate",
            }),
          },
        );
        if (!res.ok) throw new Error(await readError(res));
        done += 1;
      }
      setState("idle");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? `${error.message} (after ${done}/${parseErrorRowIndices.length} dismissed)`
          : "Bulk dismiss failed",
      );
    }
  }

  async function publish() {
    setState("publishing");
    setMessage("");
    try {
      const response = await fetch(`/api/snapshots/${snapshotId}/publish`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await readError(response));
      router.push(`/snapshots/${snapshotId}`);
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Publish failed");
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
        <div className="flex items-center gap-3">
          {gate.ok ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--color-status-current-text)]" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-[var(--color-status-danger-text)]" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Publish Gate
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {gate.ok
                ? "All checks passed — ready to publish."
                : "Resolve blockers before publishing."}
            </p>
          </div>
          <StatusTag status={gate.ok ? "GATE_OK" : "STAGING_BLOCKED"} />
        </div>
        <div className="flex flex-wrap gap-2">
          {hasWarnings ? (
            <button
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-3 text-sm font-medium text-[var(--color-status-warning-text)] hover:opacity-80 disabled:pointer-events-none disabled:opacity-60"
              disabled={state === "acknowledging"}
              onClick={acknowledgeWarnings}
              type="button"
            >
              {state === "acknowledging"
                ? "Acknowledging…"
                : `Acknowledge Warnings (${warningCodes.length})`}
            </button>
          ) : null}
          {hasParseErrorsToBulkDismiss ? (
            <button
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-3 text-sm font-medium text-[var(--color-status-warning-text)] hover:opacity-80 disabled:pointer-events-none disabled:opacity-60"
              disabled={state !== "idle"}
              onClick={dismissAllParseErrors}
              type="button"
              title="Mark every parse-error row as Reviewed in one click"
            >
              {state === "dismissing"
                ? "Dismissing…"
                : `Dismiss Parse Errors (${parseErrorRowIndices.length})`}
            </button>
          ) : null}
          <button
            className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-50"
            disabled={!canPublish}
            onClick={publish}
            type="button"
          >
            {state === "publishing" ? "Publishing…" : publishLabel}
          </button>
        </div>
      </div>

      {!gate.ok ? (
        <div className="flex flex-wrap gap-2 p-4">
          {gate.unmapped_parties_count > 0 ? (
            <GateBlockerItem>
              {gate.unmapped_parties_count} unmapped{" "}
              {gate.unmapped_parties_count === 1 ? "party" : "parties"}
            </GateBlockerItem>
          ) : null}
          {gate.fuzzy_high_pending_count > 0 ? (
            <GateBlockerItem>
              {gate.fuzzy_high_pending_count} high-confidence{" "}
              {gate.fuzzy_high_pending_count === 1 ? "match" : "matches"} pending
            </GateBlockerItem>
          ) : null}
          {gate.fuzzy_low_pending_count > 0 ? (
            <GateBlockerItem>
              {gate.fuzzy_low_pending_count} low-confidence{" "}
              {gate.fuzzy_low_pending_count === 1 ? "match" : "matches"} pending
            </GateBlockerItem>
          ) : null}
          {gate.parse_errors_unresolved_count > 0 ? (
            <GateBlockerItem>
              {gate.parse_errors_unresolved_count} unreviewed parse{" "}
              {gate.parse_errors_unresolved_count === 1 ? "error" : "errors"}
            </GateBlockerItem>
          ) : null}
          {hasWarnings ? (
            <GateBlockerItem>
              {warningCodes.length}{" "}
              {warningCodes.length === 1 ? "warning" : "warnings"} to acknowledge
            </GateBlockerItem>
          ) : null}
          {!gate.role_permits_publish ? (
            <GateBlockerItem>Your role cannot publish this snapshot</GateBlockerItem>
          ) : null}
          {gate.review_status === "PENDING_REVIEW" ? (
            <GateBlockerItem>
              Review required before publish — ask a REVIEWER to approve
            </GateBlockerItem>
          ) : null}
          {gate.review_status === "REJECTED" ? (
            <GateBlockerItem>
              Snapshot was rejected by review — discard and re-upload
            </GateBlockerItem>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p
          aria-live="polite"
          className="px-4 pb-3 text-sm text-[var(--color-status-danger-text)]"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
