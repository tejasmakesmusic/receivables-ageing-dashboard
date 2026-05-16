"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, GitCompare, History } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

const FIELD_LABEL: Record<string, string> = {
  amount: "Amount",
  due_date: "Due Date",
  credit_days: "Credit Days",
  invoice_date: "Invoice Date",
  currency: "Currency",
};

const MATERIAL_AMOUNT_THRESHOLD = 0.05; // spec §13.2

export interface InvoiceChangeItem {
  id: string;
  field: string;
  before_value: unknown;
  after_value: unknown;
  detected_at: string;
  snapshot_id: string;
  acknowledged_at: string | null;
}

function isMaterialAmountChange(change: InvoiceChangeItem): boolean {
  if (change.field !== "amount") return false;
  const before = Number(change.before_value);
  const after = Number(change.after_value);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return false;
  return Math.abs((after - before) / before) > MATERIAL_AMOUNT_THRESHOLD;
}

function formatValue(field: string, value: unknown): string {
  if (value == null) return "—";
  if (field === "amount") return String(value);
  if (field === "due_date" || field === "invoice_date") {
    return typeof value === "string" ? formatDate(value) : String(value);
  }
  return String(value);
}

/**
 * PR 3 / Gap 3 — side-panel section listing every captured field change for
 * the currently-selected invoice. Splits unacknowledged (current snapshot)
 * from history. The Acknowledge button bulk-acknowledges all
 * unacknowledged changes for this invoice.
 */
export function InvoiceChangesPanel({
  invoiceId,
  initialChanges,
  hasActiveException = false,
}: {
  invoiceId: string;
  initialChanges: InvoiceChangeItem[];
  /**
   * Spec §13.2: when an unacknowledged amount change exceeds 5% AND an
   * exception is currently open on this invoice, render a review-required
   * banner. The panel itself doesn't know about exceptions, so the parent
   * passes this flag down.
   */
  hasActiveException?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [changes, setChanges] = useState(initialChanges);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const unacked = changes.filter((c) => c.acknowledged_at == null);
  const acked = changes.filter((c) => c.acknowledged_at != null);

  const materialReviewChanges = useMemo(
    () => (hasActiveException ? unacked.filter(isMaterialAmountChange) : []),
    [hasActiveException, unacked],
  );

  if (changes.length === 0) {
    return null; // no changes captured for this invoice — render nothing
  }

  async function handleAcknowledge() {
    setError(null);
    if (unacked.length === 0) return;
    const ids = unacked.map((c) => c.id);

    try {
      const response = await fetch("/api/invoice-changes/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ change_ids: ids }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(
          payload?.message ?? `Acknowledge failed with ${response.status}`,
        );
      }
      const ackedAt = new Date().toISOString();
      setChanges((prev) =>
        prev.map((c) =>
          ids.includes(c.id) ? { ...c, acknowledged_at: ackedAt } : c,
        ),
      );
      toast.success(
        `Acknowledged ${ids.length} change${ids.length === 1 ? "" : "s"}.`,
      );
      // Refresh server data so the Changed pill / count updates everywhere.
      startTransition(() => router.refresh());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Acknowledge failed";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-[var(--color-text-muted)]" />
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">
              Changes
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              {unacked.length > 0
                ? `${unacked.length} unacknowledged · ${acked.length} in history`
                : `${acked.length} in history`}
            </div>
          </div>
        </div>
        {unacked.length > 0 ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-60"
            disabled={isPending}
            onClick={handleAcknowledge}
            type="button"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {isPending ? "Acknowledging…" : "Acknowledge all"}
          </button>
        ) : null}
      </div>

      {materialReviewChanges.length > 0 ? (
        <div
          className="flex items-start gap-2 border-b border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-4 py-3 text-sm text-[var(--color-status-danger-text)]"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Review required (spec §13.2)</div>
            <p className="mt-0.5 text-xs">
              An open exception is attached to this invoice and the amount has
              changed by more than 5% since the prior snapshot. Re-validate the
              exception before acknowledging the change.
            </p>
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-[var(--color-border)]">
        {unacked.map((change) => (
          <div
            className="grid gap-1 bg-[var(--color-status-warning-bg)]/30 px-4 py-3 text-sm"
            key={change.id}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[var(--color-text)]">
                {FIELD_LABEL[change.field] ?? change.field}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {formatDate(change.detected_at.slice(0, 10))}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <span className="rounded bg-[var(--color-bg-muted)] px-1.5 py-0.5 text-[var(--color-text-muted)] line-through">
                {formatValue(change.field, change.before_value)}
              </span>
              <span className="text-[var(--color-text-muted)]">→</span>
              <span className="rounded bg-[var(--color-status-warning-bg)] px-1.5 py-0.5 font-medium text-[var(--color-status-warning-text)]">
                {formatValue(change.field, change.after_value)}
              </span>
            </div>
          </div>
        ))}

        {acked.length > 0 ? (
          <details className="px-4 py-3">
            <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
              <History className="h-3.5 w-3.5" />
              History ({acked.length})
            </summary>
            <div className="mt-2 grid gap-2">
              {acked.map((change) => (
                <div
                  className="grid gap-1 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs"
                  key={change.id}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--color-text)]">
                      {FIELD_LABEL[change.field] ?? change.field}
                    </span>
                    <span className="text-[var(--color-text-muted)]">
                      {formatDate(change.detected_at.slice(0, 10))}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 tabular-nums text-[var(--color-text-muted)]">
                    <span className="line-through">
                      {formatValue(change.field, change.before_value)}
                    </span>
                    <span>→</span>
                    <span>
                      {formatValue(change.field, change.after_value)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-status-danger-text)]"
        >
          {error}
        </p>
      ) : null}

      <input
        name="invoice-id"
        type="hidden"
        value={invoiceId}
        readOnly
      />
    </div>
  );
}
