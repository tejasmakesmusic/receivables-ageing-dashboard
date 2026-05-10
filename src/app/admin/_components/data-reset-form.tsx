"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_CONFIRMATION_PHRASE = "RESET IMPORTED DATA";

type ResetCounts = Record<string, number>;

type DataResetFormProps = {
  confirmationPhrase?: string;
  counts: ResetCounts;
};

type ResetResponse =
  | {
      deleted?: ResetCounts;
      message?: string;
    }
  | null;

const countLabels: Record<string, string> = {
  snapshots: "Snapshots",
  invoices: "Invoices",
  invoice_snapshots: "Invoice snapshots",
  collection_tasks: "Collection tasks",
  promises_to_pay: "Promises to pay",
  dispute_cases: "Disputes",
  follow_ups: "Follow-ups",
  exception_tags: "Exception tags",
  reconciliation_entries: "Reconciliation entries",
  digest_events: "Digest events",
  email_outbox: "Email outbox",
};

const importantCounts = [
  "snapshots",
  "invoices",
  "invoice_snapshots",
  "collection_tasks",
  "promises_to_pay",
  "dispute_cases",
  "follow_ups",
  "email_outbox",
] as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function zeroCounts(counts: ResetCounts) {
  return Object.fromEntries(
    Object.keys(counts).map((key) => [key, 0]),
  ) as ResetCounts;
}

export default function DataResetForm({
  confirmationPhrase = DEFAULT_CONFIRMATION_PHRASE,
  counts,
}: DataResetFormProps) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [displayCounts, setDisplayCounts] = useState(counts);
  const totalRows = useMemo(
    () => Object.values(displayCounts).reduce((sum, value) => sum + value, 0),
    [displayCounts],
  );
  const isConfirmed = confirmation === confirmationPhrase;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isConfirmed) {
      setStatus("error");
      setMessage(`Type ${confirmationPhrase} to enable imported-data reset.`);
      return;
    }

    setStatus("submitting");
    setMessage("");

    const response = await fetch("/api/admin/data-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation }),
    });
    const payload = (await response.json().catch(() => null)) as ResetResponse;

    if (!response.ok) {
      setStatus("error");
      setMessage(
        payload?.message ??
          "Imported-data reset failed. Check audit logs and try again.",
      );
      return;
    }

    setStatus("success");
    setConfirmation("");
    setDisplayCounts(zeroCounts(payload?.deleted ?? displayCounts));
    setMessage("Imported receivables data removed. Audit log retained.");
    router.refresh();
  }

  return (
    <form className="space-y-4 p-4" onSubmit={handleSubmit}>
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] p-3 text-sm text-[var(--color-status-danger-text)]">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Imported data only</div>
            <div className="mt-1 text-xs leading-5">
              Removes uploaded receivables snapshots, invoices, work queues,
              promises, disputes, follow-ups, reconciliation rows, digest
              events, and queued emails. Users, entities, credit rules, FX,
              aliases, and audit history remain.
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span>Rows in reset scope</span>
          <span className="font-mono text-[var(--color-text)]">
            {formatNumber(totalRows)}
          </span>
        </div>
        <div className="divide-y divide-[var(--color-border)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
          {importantCounts.map((key) => (
            <div
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              key={key}
            >
              <span className="text-[var(--color-text-muted)]">
                {countLabels[key]}
              </span>
              <span className="font-mono font-medium text-[var(--color-text)]">
                {formatNumber(displayCounts[key] ?? 0)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <label className="grid gap-2 text-sm font-medium text-[var(--color-text)]">
        Confirmation phrase
        <code className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] px-2 py-1 text-xs text-[var(--color-text)]">
          {confirmationPhrase}
        </code>
        <input
          autoComplete="off"
          className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
          name="confirmation"
          onChange={(event) => setConfirmation(event.target.value)}
          value={confirmation}
        />
      </label>

      <Button
        className="w-full"
        disabled={!isConfirmed || status === "submitting"}
        type="submit"
        variant="destructive"
      >
        <RotateCcw className="h-4 w-4" />
        {status === "submitting" ? "Removing data..." : "Remove Imported Data"}
      </Button>

      {message ? (
        <div
          aria-live="polite"
          className={
            status === "error"
              ? "text-sm text-[var(--color-status-danger-text)]"
              : "text-sm text-[var(--color-text-muted)]"
          }
        >
          {message}
        </div>
      ) : null}
    </form>
  );
}
