"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { ActionFeedback } from "@/components/ui/action-feedback";
import {
  buildActionFeedback,
  type ActionFeedbackModel,
} from "@/components/ui/action-feedback-copy";
import { Badge } from "@/components/ui/badge";
import { StatusTag } from "@/components/ui/status-tag";

interface Task {
  id: string;
  status: string;
  reason_code: string;
  priority_score: number | string;
  due_date: string | null;
  dismissed_reason: string | null;
  owner_user_id: string | null;
  created_at: string;
  updated_at: string;
  canonical_id: string;
  invoice_id: string | null;
  entity_id: string;
  collection_task_id?: string | null;
}

const DISPUTE_REASON_CODES = [
  { value: "AMOUNT_DISPUTED", label: "Amount Disputed" },
  { value: "SERVICE_NOT_RENDERED", label: "Service Not Rendered" },
  { value: "DUPLICATE_INVOICE", label: "Duplicate Invoice" },
  { value: "CREDIT_NOTE_PENDING", label: "Credit Note Pending" },
  { value: "OTHER", label: "Other" },
] as const;

type ActiveForm = "ptp" | "dispute" | null;

export function TaskSidePanel({ task }: { task: Task | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Form visibility
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);

  const [actionFeedback, setActionFeedback] =
    useState<ActionFeedbackModel | null>(null);

  // PTP form state
  const [ptpAmount, setPtpAmount] = useState("");
  const [ptpDate, setPtpDate] = useState("");
  const [ptpContact, setPtpContact] = useState("");
  const [ptpNotes, setPtpNotes] = useState("");
  const [ptpSubmitting, setPtpSubmitting] = useState(false);
  const [ptpError, setPtpError] = useState<string | null>(null);

  // Dispute form state
  const [disputeReasonCode, setDisputeReasonCode] = useState<string>("AMOUNT_DISPUTED");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [disputeResDate, setDisputeResDate] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputeError, setDisputeError] = useState<string | null>(null);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  const openForm = useCallback((form: ActiveForm) => {
    setActiveForm(form);
    setActionFeedback(null);
    setPtpError(null);
    setDisputeError(null);
    setClaimError(null);
  }, []);

  const handleClaimTask = useCallback(async () => {
    if (!task) return;

    setClaimSubmitting(true);
    setClaimError(null);

    try {
      const res = await fetch(`/api/collection-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "OPEN" }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          body.message ?? body.error ?? `Request failed with ${res.status}`,
        );
      }

      router.refresh();
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : "Task claim failed");
    } finally {
      setClaimSubmitting(false);
    }
  }, [task, router]);

  const handlePtpSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!task) return;
      setPtpSubmitting(true);
      setPtpError(null);
      try {
        const res = await fetch("/api/promises-to-pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canonical_id: task.canonical_id,
            invoice_id: task.invoice_id,
            collection_task_id: task.id,
            amount: Number(ptpAmount),
            currency: "INR",
            promised_date: ptpDate,
            ...(ptpContact ? { contact_person: ptpContact } : {}),
            ...(ptpNotes ? { notes: ptpNotes } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        // Reset form
        setPtpAmount("");
        setPtpDate("");
        setPtpContact("");
        setPtpNotes("");
        setActiveForm(null);
        setActionFeedback(
          buildActionFeedback({
            action: "PTP_CREATED",
            amount: `INR ${Number(ptpAmount).toLocaleString("en-IN", {
              maximumFractionDigits: 2,
            })}`,
            nextDate: ptpDate,
            priorityAfter: Number(task.priority_score),
            priorityBefore: Number(task.priority_score),
            status: "PTP_OPEN",
          }),
        );
        setTimeout(() => {
          setActionFeedback(null);
          router.refresh();
        }, 4000);
      } catch (err) {
        setPtpError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setPtpSubmitting(false);
      }
    },
    [task, ptpAmount, ptpDate, ptpContact, ptpNotes, router],
  );

  const handleDisputeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!task) return;
      setDisputeSubmitting(true);
      setDisputeError(null);
      try {
        const res = await fetch("/api/dispute-cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_id: task.entity_id,
            canonical_id: task.canonical_id,
            invoice_id: task.invoice_id,
            reason_code: disputeReasonCode,
            description: disputeDescription,
            ...(disputeResDate ? { expected_resolution_date: disputeResDate } : {}),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
        // Reset form
        setDisputeReasonCode("AMOUNT_DISPUTED");
        setDisputeDescription("");
        setDisputeResDate("");
        setActiveForm(null);
        setActionFeedback(
          buildActionFeedback({
            action: "DISPUTE_RAISED",
            nextDate: disputeResDate || null,
            priorityAfter: Number(task.priority_score),
            priorityBefore: Number(task.priority_score),
            reference: disputeReasonCode,
            status: "DISPUTE_OPEN",
          }),
        );
        setTimeout(() => {
          setActionFeedback(null);
          router.refresh();
        }, 4000);
      } catch (err) {
        setDisputeError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setDisputeSubmitting(false);
      }
    },
    [task, disputeReasonCode, disputeDescription, disputeResDate, router],
  );

  if (!task) return null;

  const today = new Date().toISOString().split("T")[0];

  return (
    <aside className="w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-subtle)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-[var(--spacing-4)] py-[var(--spacing-3)] border-b border-[var(--color-border)]">
        <span className="text-sm font-medium text-[var(--color-text)]">
          Task detail
        </span>
        <button
          onClick={close}
          className="text-[var(--color-text-subtle)] hover:text-[var(--color-text)] text-lg leading-none"
          aria-label="Close panel"
          type="button"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="p-[var(--spacing-4)] space-y-[var(--spacing-4)]">
        <div className="flex items-center gap-[var(--spacing-2)]">
          <StatusTag status={`TASK_${task.status}`} />
          <Badge variant="default">{task.reason_code.replace(/_/g, " ")}</Badge>
        </div>

        <dl className="grid grid-cols-2 gap-x-[var(--spacing-2)] gap-y-[var(--spacing-3)] text-sm">
          <dt className="text-[var(--color-text-subtle)]">Priority</dt>
          <dd className="text-[var(--color-text)] font-medium">
            {Number(task.priority_score).toFixed(0)}
          </dd>

          <dt className="text-[var(--color-text-subtle)]">Due date</dt>
          <dd className="text-[var(--color-text)]">
            {task.due_date
              ? new Date(task.due_date).toLocaleDateString()
              : "—"}
          </dd>

          <dt className="text-[var(--color-text-subtle)]">Owner</dt>
          <dd className="text-[var(--color-text)] truncate">
            {task.owner_user_id ?? "Unassigned"}
          </dd>

          {task.dismissed_reason && (
            <>
              <dt className="text-[var(--color-text-subtle)]">
                Dismissed reason
              </dt>
              <dd className="text-[var(--color-text)]">
                {task.dismissed_reason}
              </dd>
            </>
          )}

          <dt className="text-[var(--color-text-subtle)]">Created</dt>
          <dd className="text-[var(--color-text)]">
            {new Date(task.created_at).toLocaleDateString()}
          </dd>

          <dt className="text-[var(--color-text-subtle)]">Invoice</dt>
          <dd className="text-[var(--color-text)] truncate font-mono text-xs">
            {task.invoice_id ? task.invoice_id.slice(0, 8) + "…" : "—"}
          </dd>

          {task.collection_task_id && (
            <>
              <dt className="text-[var(--color-text-subtle)]">PTP</dt>
              <dd className="text-[var(--color-text)] truncate font-mono text-xs">
                {task.collection_task_id.slice(0, 8)}…
              </dd>
            </>
          )}
        </dl>

        {/* Quick actions */}
        {task.status === "SUGGESTED" && (
          <div className="pt-[var(--spacing-2)] border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-subtle)] mb-[var(--spacing-2)]">
              Claim this task to begin working on it.
            </p>
            <button
              className="inline-flex items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-white hover:opacity-90 transition-opacity"
              disabled={claimSubmitting}
              onClick={handleClaimTask}
              type="button"
            >
              Claim → Open
            </button>
            {claimError ? (
              <p aria-live="polite" className="mt-2 text-xs text-red-600">
                {claimError}
              </p>
            ) : null}
          </div>
        )}

        {/* ── Action buttons ─────────────────────────────────────────────── */}
        <div className="pt-[var(--spacing-2)] border-t border-[var(--color-border)] flex flex-col gap-[var(--spacing-2)]">
          {actionFeedback ? <ActionFeedback feedback={actionFeedback} /> : null}

          {/* Log PTP button */}
          {activeForm !== "ptp" && (
            <button
              type="button"
              onClick={() => openForm("ptp")}
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              Log Promise to Pay
            </button>
          )}

          {/* Raise Dispute button */}
          {activeForm !== "dispute" && (
            <button
              type="button"
              onClick={() => openForm("dispute")}
              className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)] transition-colors"
            >
              Raise Dispute
            </button>
          )}
        </div>

        {/* ── Log PTP inline form ─────────────────────────────────────────── */}
        {activeForm === "ptp" && (
          <form
            onSubmit={handlePtpSubmit}
            className="flex flex-col gap-[var(--spacing-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-[var(--spacing-3)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-text)]">
                Log Promise to Pay
              </span>
              <button
                type="button"
                onClick={() => setActiveForm(null)}
                className="text-[var(--color-text-subtle)] hover:text-[var(--color-text)] text-base leading-none"
                aria-label="Cancel"
              >
                ×
              </button>
            </div>

            {/* Amount */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">
                Amount <span className="text-red-500">*</span>
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={ptpAmount}
                onChange={(e) => setPtpAmount(e.target.value)}
                placeholder="0.00"
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </label>

            {/* Currency (read-only) */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">Currency</span>
              <span className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text-subtle)]">
                INR
              </span>
            </label>

            {/* Promised date */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">
                Promised date <span className="text-red-500">*</span>
              </span>
              <input
                type="date"
                required
                min={today}
                value={ptpDate}
                onChange={(e) => setPtpDate(e.target.value)}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </label>

            {/* Contact person */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">Contact person</span>
              <input
                type="text"
                value={ptpContact}
                onChange={(e) => setPtpContact(e.target.value)}
                placeholder="Optional"
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </label>

            {/* Notes */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">Notes</span>
              <textarea
                rows={3}
                value={ptpNotes}
                onChange={(e) => setPtpNotes(e.target.value)}
                placeholder="Optional"
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none"
              />
            </label>

            {ptpError && (
              <p className="text-xs text-red-600">{ptpError}</p>
            )}

            <div className="flex gap-[var(--spacing-2)]">
              <button
                type="submit"
                disabled={ptpSubmitting}
                className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {ptpSubmitting ? "Saving…" : "Submit"}
              </button>
              <button
                type="button"
                onClick={() => setActiveForm(null)}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* ── Raise Dispute inline form ───────────────────────────────────── */}
        {activeForm === "dispute" && (
          <form
            onSubmit={handleDisputeSubmit}
            className="flex flex-col gap-[var(--spacing-3)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-[var(--spacing-3)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--color-text)]">
                Raise Dispute
              </span>
              <button
                type="button"
                onClick={() => setActiveForm(null)}
                className="text-[var(--color-text-subtle)] hover:text-[var(--color-text)] text-base leading-none"
                aria-label="Cancel"
              >
                ×
              </button>
            </div>

            {/* Reason code */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">
                Reason <span className="text-red-500">*</span>
              </span>
              <select
                required
                value={disputeReasonCode}
                onChange={(e) => setDisputeReasonCode(e.target.value)}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              >
                {DISPUTE_REASON_CODES.map((rc) => (
                  <option key={rc.value} value={rc.value}>
                    {rc.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Description */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">
                Description <span className="text-red-500">*</span>
              </span>
              <textarea
                rows={3}
                required
                value={disputeDescription}
                onChange={(e) => setDisputeDescription(e.target.value)}
                placeholder="Describe the dispute…"
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] resize-none"
              />
            </label>

            {/* Expected resolution date */}
            <label className="flex flex-col gap-[var(--spacing-1)]">
              <span className="text-xs text-[var(--color-text-subtle)]">Expected resolution date</span>
              <input
                type="date"
                value={disputeResDate}
                onChange={(e) => setDisputeResDate(e.target.value)}
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-[var(--spacing-1)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </label>

            {disputeError && (
              <p className="text-xs text-red-600">{disputeError}</p>
            )}

            <div className="flex gap-[var(--spacing-2)]">
              <button
                type="submit"
                disabled={disputeSubmitting}
                className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {disputeSubmitting ? "Saving…" : "Submit"}
              </button>
              <button
                type="button"
                onClick={() => setActiveForm(null)}
                className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-transparent px-[var(--spacing-3)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </aside>
  );
}
