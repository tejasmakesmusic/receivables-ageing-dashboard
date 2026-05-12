import { Prisma } from "@/generated/prisma/client";

/**
 * PR 2 / Gap 2 — Option A: when invoices are bulk-settled by a snapshot
 * publish, cascade-resolve every operational object attached to those
 * invoices. The user picked Option A: silent auto-resolve for ALL kinds
 * (PTPs, disputes, collection tasks, exception tags) — the audit log row
 * captures the counts so analysts can review.
 *
 * Follow-ups are deliberately skipped: they're append-only history rows
 * with no status/lifecycle column.
 *
 * Mapping uses existing terminal enum values (no schema migration needed):
 *   promises_to_pay  OPEN/…              → CANCELLED
 *   dispute_cases    OPEN/IN_REVIEW/W…   → CLOSED + resolved_at
 *   collection_tasks SUGGESTED/OPEN/…    → DISMISSED + completed_at
 *   exception_tags   ACTIVE              → AUTO_RESOLVED + resolved_at
 *
 * The dedicated reason fields (resolution_note, dismissed_reason) are
 * populated with a structured marker that includes the snapshot id so the
 * cascade is auditable from the row itself. promises_to_pay.notes is
 * left untouched because it's free-form user-authored content.
 */
export type AutoResolveCounts = {
  promises_to_pay: number;
  dispute_cases: number;
  collection_tasks: number;
  exception_tags: number;
};

export async function autoResolveCascadeOnSettle(
  tx: Prisma.TransactionClient,
  options: { snapshotId: string; settledInvoiceIds: string[]; now: Date },
): Promise<AutoResolveCounts> {
  const { snapshotId, settledInvoiceIds, now } = options;
  const empty: AutoResolveCounts = {
    promises_to_pay: 0,
    dispute_cases: 0,
    collection_tasks: 0,
    exception_tags: 0,
  };
  if (settledInvoiceIds.length === 0) return empty;

  const reason = `Auto-resolved: invoice settled in snapshot ${snapshotId}`;

  const ptp = await tx.promises_to_pay.updateMany({
    where: { invoice_id: { in: settledInvoiceIds }, status: "OPEN" },
    data: { status: "CANCELLED", updated_at: now },
  });

  const disputes = await tx.dispute_cases.updateMany({
    where: {
      invoice_id: { in: settledInvoiceIds },
      status: { in: ["OPEN", "IN_REVIEW", "WAITING_ON_CUSTOMER"] },
    },
    data: {
      status: "CLOSED",
      resolved_at: now,
      resolution_note: reason,
      updated_at: now,
    },
  });

  const tasks = await tx.collection_tasks.updateMany({
    where: {
      invoice_id: { in: settledInvoiceIds },
      status: { in: ["SUGGESTED", "OPEN", "IN_PROGRESS", "SNOOZED"] },
    },
    data: {
      status: "DISMISSED",
      completed_at: now,
      dismissed_reason: reason,
      updated_at: now,
    },
  });

  const exceptions = await tx.exception_tags.updateMany({
    where: { invoice_id: { in: settledInvoiceIds }, status: "ACTIVE" },
    data: {
      status: "AUTO_RESOLVED",
      resolved_at: now,
      resolution_note: reason,
    },
  });

  return {
    promises_to_pay: ptp.count,
    dispute_cases: disputes.count,
    collection_tasks: tasks.count,
    exception_tags: exceptions.count,
  };
}
