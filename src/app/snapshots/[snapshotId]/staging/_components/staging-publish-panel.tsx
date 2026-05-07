"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublishGate } from "@/server/snapshots/service";

type ActionState = "idle" | "acknowledging" | "publishing" | "error";

type ApiError = {
  error?: string;
  message?: string;
};

type WarningsAckResponse = {
  publish_gate: PublishGate;
};

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

      if (!response.ok) {
        throw new Error(await readError(response));
      }

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

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      router.push(`/snapshots/${snapshotId}`);
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Publish failed");
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            Review Gate
          </h2>
          <p className="text-slate-500">
            {gate.ok
              ? "All publish checks are clear."
              : "Clear the listed blockers before publishing."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasWarnings ? (
            <button
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-900 hover:bg-amber-100 disabled:pointer-events-none disabled:opacity-60"
              disabled={state === "acknowledging"}
              onClick={acknowledgeWarnings}
              type="button"
            >
              {state === "acknowledging"
                ? "Acknowledging..."
                : "Acknowledge Warnings"}
            </button>
          ) : null}
          <button
            className="rounded bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
            disabled={!canPublish}
            onClick={publish}
            type="button"
          >
            {state === "publishing" ? "Publishing..." : publishLabel}
          </button>
        </div>
      </div>

      {!gate.ok ? (
        <ul className="mt-4 grid gap-2 text-slate-700 sm:grid-cols-2">
          {gate.unmapped_parties_count > 0 ? (
            <li>Unmapped parties: {gate.unmapped_parties_count}</li>
          ) : null}
          {gate.fuzzy_high_pending_count > 0 ? (
            <li>Fuzzy matches pending: {gate.fuzzy_high_pending_count}</li>
          ) : null}
          {gate.fuzzy_low_pending_count > 0 ? (
            <li>Low-confidence matches pending: {gate.fuzzy_low_pending_count}</li>
          ) : null}
          {gate.parse_errors_unresolved_count > 0 ? (
            <li>Parse errors unresolved: {gate.parse_errors_unresolved_count}</li>
          ) : null}
          {hasWarnings ? (
            <li>Warnings to acknowledge: {warningCodes.join(", ")}</li>
          ) : null}
          {!gate.role_permits_publish ? (
            <li>Your role cannot publish this snapshot.</li>
          ) : null}
        </ul>
      ) : null}

      {message ? (
        <p aria-live="polite" className="mt-3 text-sm text-red-700">
          {message}
        </p>
      ) : null}
    </section>
  );
}
