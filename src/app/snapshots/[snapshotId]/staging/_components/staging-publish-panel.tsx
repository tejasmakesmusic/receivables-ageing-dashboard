"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import type { PublishGate } from "@/server/snapshots/service";

type ActionState = "idle" | "acknowledging" | "publishing" | "error";

type ApiError = {
  error?: string;
  message?: string;
};

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
}: {
  publishGate: PublishGate;
  snapshotId: string;
  sourceHint: string;
}) {
  const router = useRouter();
  const [gate, setGate] = useState(publishGate);
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");

  const warningCodes = gate.warnings_unacknowledged;
  const hasWarnings = warningCodes.length > 0;
  const canPublish = gate.ok && state !== "publishing";
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
      const payload = (await response.json()) as WarningsAckResponse;
      setGate(payload.publish_gate);
      setState("idle");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Could not acknowledge warnings",
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
