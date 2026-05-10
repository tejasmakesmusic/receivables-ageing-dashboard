"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Status = "idle" | "submitting" | "error";

/**
 * PR 7 — REVIEWER (or ADMIN) approves/rejects a STAGED snapshot.
 * Renders nothing for non-eligible roles or non-STAGED snapshots — the
 * server-rendered metadata block already shows the resulting decision.
 */
export function SnapshotReviewActions({
  snapshotId,
}: {
  snapshotId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  async function submit(decision: "APPROVED" | "REJECTED") {
    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch(`/api/snapshots/${snapshotId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          note: note.trim() ? note.trim() : undefined,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(
          payload?.message ?? `Review failed with ${response.status}`,
        );
      }
      setStatus("idle");
      setNote("");
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Review failed");
    }
  }

  return (
    <div className="grid gap-3">
      <textarea
        className="min-h-[60px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
        disabled={status === "submitting" || isPending}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional review note (visible on the snapshot)…"
        value={note}
      />
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-60"
          disabled={status === "submitting" || isPending}
          onClick={() => submit("APPROVED")}
          type="button"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </button>
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 text-xs font-medium text-[var(--color-status-danger-text)] transition-colors hover:opacity-80 disabled:pointer-events-none disabled:opacity-60"
          disabled={status === "submitting" || isPending}
          onClick={() => submit("REJECTED")}
          type="button"
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
      {message ? (
        <p
          aria-live="polite"
          className="text-xs text-[var(--color-status-danger-text)]"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
