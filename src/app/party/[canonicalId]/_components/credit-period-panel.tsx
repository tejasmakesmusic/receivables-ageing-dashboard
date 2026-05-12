"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Clock } from "lucide-react";
import { formatDate } from "@/lib/format";

type CreditPeriodConfig = {
  id: string;
  days: number;
  valid_from: string;
  reason_note: string | null;
  updated_by_email: string | null;
} | null;

type Props = {
  canonicalId: string;
  currentConfig: CreditPeriodConfig;
  canEdit: boolean; // ANALYST or ADMIN, not CFO
};

export function CreditPeriodPanel({ canonicalId, currentConfig, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(String(currentConfig?.days ?? ""));
  const [validFrom, setValidFrom] = useState(
    currentConfig?.valid_from?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(currentConfig?.reason_note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const daysNum = parseInt(days, 10);
    if (!days || isNaN(daysNum) || daysNum < 0) {
      setError("Enter a valid number of days (0 or more).");
      return;
    }
    if (!validFrom) {
      setError("Effective date is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/config/credit-period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_id: canonicalId,
          credit_days: daysNum,
          valid_from: validFrom,
          reason_note: note.trim() || null,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null) as
          | { message?: string; error?: string }
          | null;
        throw new Error(
          payload?.message ?? payload?.error ?? `Failed (${res.status})`,
        );
      }

      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit() {
    // Reset form to current values
    setDays(String(currentConfig?.days ?? ""));
    setValidFrom(
      currentConfig?.valid_from?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    );
    setNote(currentConfig?.reason_note ?? "");
    setError("");
    setEditing(true);
  }

  return (
    <div className="space-y-3 p-4 text-sm">
      {currentConfig ? (
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <span className="text-2xl font-semibold tabular-nums text-[var(--color-text)]">
                {currentConfig.days}
              </span>
              <span className="text-sm text-[var(--color-text-muted)]">days</span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              From {formatDate(currentConfig.valid_from)}
            </p>
            {currentConfig.reason_note ? (
              <p className="mt-1 text-xs italic text-[var(--color-text-muted)]">
                &ldquo;{currentConfig.reason_note}&rdquo;
              </p>
            ) : null}
            {currentConfig.updated_by_email ? (
              <p className="mt-1 text-[10px] text-[var(--color-text-subtle)]">
                Set by {currentConfig.updated_by_email}
              </p>
            ) : null}
          </div>
          {canEdit && !editing ? (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
              onClick={openEdit}
              type="button"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">
            No credit period set. Invoices use the entity default.
          </p>
          {canEdit && !editing ? (
            <button
              className="mt-2 text-xs font-medium text-[var(--color-accent)] hover:underline"
              onClick={openEdit}
              type="button"
            >
              Set credit period →
            </button>
          ) : null}
        </div>
      )}

      {canEdit && editing ? (
        <form
          className="space-y-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3"
          onSubmit={handleSubmit}
        >
          <div className="flex gap-3">
            <div className="flex-1">
              <label
                className="mb-1 block text-xs text-[var(--color-text-muted)]"
                htmlFor="cp-days"
              >
                Credit days
              </label>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                id="cp-days"
                inputMode="numeric"
                min="0"
                onChange={(e) => setDays(e.target.value)}
                placeholder="e.g. 30"
                required
                type="number"
                value={days}
              />
            </div>
            <div className="flex-1">
              <label
                className="mb-1 block text-xs text-[var(--color-text-muted)]"
                htmlFor="cp-valid-from"
              >
                Effective from
              </label>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                id="cp-valid-from"
                onChange={(e) => setValidFrom(e.target.value)}
                required
                type="date"
                value={validFrom}
              />
            </div>
          </div>
          <div>
            <label
              className="mb-1 block text-xs text-[var(--color-text-muted)]"
              htmlFor="cp-note"
            >
              Note (optional)
            </label>
            <input
              className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              id="cp-note"
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Extended per agreement"
              type="text"
              value={note}
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
              {submitting ? "Saving…" : "Save"}
            </button>
            <button
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
              onClick={() => { setEditing(false); setError(""); }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
