"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import { formatCurrency } from "@/lib/format";

type ReconciliationStatus = "MATCHED" | "MISMATCHED" | "UNRECONCILED";

type Props = {
  snapshotId: string;
  currency: string;
  dashboardAr: string;
  existingClosingAr: string | null;
  existingNotes: string | null;
  existingStatus: ReconciliationStatus;
  existingEnteredBy: string | null;
  existingEnteredAt: string | null; // pre-formatted string, not a raw ISO date
  isAdmin: boolean;
};

export function ReconciliationForm({
  snapshotId,
  currency,
  dashboardAr,
  existingClosingAr,
  existingNotes,
  existingStatus,
  existingEnteredBy,
  existingEnteredAt,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [closingAr, setClosingAr] = useState(existingClosingAr ?? "");
  const [notes, setNotes] = useState(existingNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!closingAr.trim()) {
      setError("Closing AR is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/snapshots/${snapshotId}/reconciliation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tally_xero_closing_ar: closingAr.trim(),
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { message?: string; error?: string } | null;
        throw new Error(payload?.message ?? payload?.error ?? `Request failed (${res.status})`);
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  const dashboardDisplay = formatCurrency(dashboardAr, currency);
  const closingDisplay = existingClosingAr ? formatCurrency(existingClosingAr, currency) : "—";

  return (
    <div className="p-4 text-sm">
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Dashboard AR</dt>
          <dd className="mt-0.5 font-medium text-[var(--color-text)]">{dashboardDisplay}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Closing AR (Tally/Xero)</dt>
          <dd className="mt-0.5 font-medium text-[var(--color-text)]">{closingDisplay}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Status</dt>
          <dd className="mt-0.5">
            <StatusTag status={existingStatus} />
          </dd>
        </div>
        {existingEnteredBy ? (
          <div className="sm:col-span-3">
            <dt className="text-xs text-[var(--color-text-muted)]">Entered by</dt>
            <dd className="mt-0.5 text-[var(--color-text-muted)]">
              {existingEnteredBy}
              {existingEnteredAt ? ` · ${existingEnteredAt}` : ""}
            </dd>
          </div>
        ) : null}
      </div>

      {existingStatus === "MATCHED" ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] px-3 py-2 text-xs text-[var(--color-status-current-text)]">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Dashboard AR and closing AR are aligned.
          {isAdmin ? (
            <button
              className="ml-auto shrink-0 text-xs underline hover:no-underline"
              onClick={() => setEditing(true)}
              type="button"
            >
              Update
            </button>
          ) : null}
        </div>
      ) : existingStatus === "MISMATCHED" ? (
        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 py-2 text-xs text-[var(--color-status-danger-text)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {existingNotes ? `Mismatch noted: ${existingNotes}` : "Dashboard AR and closing AR do not match."}
          {isAdmin ? (
            <button
              className="ml-auto shrink-0 text-xs underline hover:no-underline"
              onClick={() => setEditing(true)}
              type="button"
            >
              Update
            </button>
          ) : null}
        </div>
      ) : isAdmin ? (
        <button
          className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
          onClick={() => setEditing(true)}
          type="button"
        >
          Enter closing AR manually →
        </button>
      ) : (
        <p className="text-xs text-[var(--color-text-muted)]">No closing AR entry recorded yet.</p>
      )}

      {isAdmin && editing ? (
        <form
          className="mt-4 space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4"
          onSubmit={handleSubmit}
        >
          <p className="text-xs font-semibold text-[var(--color-text)]">
            {existingClosingAr ? "Adjust closing AR" : "Enter closing AR manually"}
          </p>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="recon-closing-ar">
              Closing AR ({currency})
            </label>
            <input
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              id="recon-closing-ar"
              inputMode="decimal"
              onChange={(e) => setClosingAr(e.target.value)}
              placeholder="e.g. 13194172823.00"
              required
              type="text"
              value={closingAr}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--color-text-muted)]" htmlFor="recon-notes">
              Notes (optional)
            </label>
            <textarea
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              id="recon-notes"
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explain any mismatch or add context…"
              rows={2}
              value={notes}
            />
          </div>
          {error ? (
            <p className="text-xs text-[var(--color-status-danger-text)]">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-50"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Saving…" : "Save tie-out"}
            </button>
            {existingClosingAr ? (
              <button
                className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
                onClick={() => { setEditing(false); setError(""); }}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
