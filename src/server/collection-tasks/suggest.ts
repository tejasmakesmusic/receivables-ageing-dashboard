import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  collection_task_reason_code,
  collection_task_source_type,
  collection_task_status,
  promise_to_pay_status,
  dispute_case_status,
} from "@/generated/prisma/enums";
import { createId } from "@/lib/ids";
import { computePriorityScore } from "./priority";

// Configurable thresholds — override via env vars in production
const HIGH_VALUE_THRESHOLD =
  Number(process.env.COLLECTION_HIGH_VALUE_THRESHOLD) || 100_000;
const STALE_CONTACT_DAYS =
  Number(process.env.COLLECTION_STALE_CONTACT_DAYS) || 30;

type PrismaTx = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export interface SuggestBatchResult {
  total: number;
  by_reason_code: Record<string, number>;
}

/**
 * Generate suggested collection tasks for a freshly published snapshot.
 *
 * Called inside the publish transaction. Reads the snapshot's invoice_snapshots
 * rows and the current state of PTPs and disputes to emit one task per matching
 * rule per invoice. Deduplicates against existing SUGGESTED tasks from this
 * same snapshot to make re-runs idempotent.
 *
 * Audit log: a single summary row written by the caller (publishSnapshot),
 * NOT one row per task (spec §2026-05-01 approval #4).
 */
export async function generateSuggestedTasks(
  tx: PrismaTx,
  params: {
    snapshotId: string;
    entityId: string;
    asOfDate: string; // YYYY-MM-DD from snapshot.as_of_date
    publishedBy: string;
  },
): Promise<SuggestBatchResult> {
  const { snapshotId, entityId, publishedBy } = params;
  const asOfDate = new Date(params.asOfDate);

  // ── 1. Load all invoice_snapshots for this publish ───────────────────────
  const invoiceSnaps = await tx.invoice_snapshots.findMany({
    where: { snapshot_id: snapshotId },
    select: {
      invoice_id: true,
      outstanding_amount: true,
      bucket: true,
      invoices: { select: { canonical_id: true } },
    },
  });

  if (invoiceSnaps.length === 0) {
    return { total: 0, by_reason_code: {} };
  }

  const invoiceIds = invoiceSnaps.map((s) => s.invoice_id);
  const canonicalIds = [
    ...new Set(invoiceSnaps.map((s) => s.invoices.canonical_id)),
  ];

  // ── 2. Load open/broken PTPs for these invoices ──────────────────────────
  const ptps = await tx.promises_to_pay.findMany({
    where: {
      invoice_id: { in: invoiceIds },
      status: { in: [promise_to_pay_status.OPEN, promise_to_pay_status.BROKEN] },
    },
    select: { invoice_id: true, status: true },
  });
  const brokenPtpInvoiceIds = new Set(
    ptps
      .filter((p) => p.status === promise_to_pay_status.BROKEN)
      .map((p) => p.invoice_id)
      .filter(Boolean) as string[],
  );

  // ── 3. Load open dispute cases for these invoices ────────────────────────
  const disputes = await tx.dispute_cases.findMany({
    where: {
      invoice_id: { in: invoiceIds },
      status: { in: [dispute_case_status.OPEN, dispute_case_status.IN_REVIEW] },
    },
    select: { invoice_id: true },
  });
  const openDisputeInvoiceIds = new Set(
    disputes.map((d) => d.invoice_id).filter(Boolean) as string[],
  );

  // ── 4. Load latest follow-up date per canonical party ────────────────────
  const staleThresholdDate = new Date(asOfDate);
  staleThresholdDate.setDate(staleThresholdDate.getDate() - STALE_CONTACT_DAYS);

  const latestFollowUps = await tx.follow_ups.findMany({
    where: { canonical_id: { in: canonicalIds } },
    select: { canonical_id: true, date: true },
    orderBy: { date: "desc" },
    distinct: ["canonical_id"],
  });
  const staleCanonicalIds = new Set(
    canonicalIds.filter((cid) => {
      const latest = latestFollowUps.find((f) => f.canonical_id === cid);
      return !latest || latest.date < staleThresholdDate;
    }),
  );

  // ── 5. Load existing SUGGESTED tasks from this snapshot (idempotency) ────
  const existingTasks = await tx.collection_tasks.findMany({
    where: {
      source_snapshot_id: snapshotId,
      status: collection_task_status.SUGGESTED,
    },
    select: { invoice_id: true, reason_code: true },
  });
  const existingSet = new Set(
    existingTasks.map((t) => `${t.invoice_id}:${t.reason_code}`),
  );

  // ── 6. Apply rules and collect new tasks ────────────────────────────────
  const tasksToCreate: Prisma.collection_tasksCreateManyInput[] = [];
  const countsByReason: Record<string, number> = {};

  function addTask(
    snap: (typeof invoiceSnaps)[number],
    reasonCode: collection_task_reason_code,
    hasBrokenPtp: boolean,
    hasOpenDispute: boolean,
    isStale: boolean,
  ) {
    const key = `${snap.invoice_id}:${reasonCode}`;
    if (existingSet.has(key)) return;

    const priority = computePriorityScore({
      bucket: snap.bucket,
      outstandingAmount: Number(snap.outstanding_amount),
      highValueThreshold: HIGH_VALUE_THRESHOLD,
      hasBrokenPtp,
      hasOpenDispute,
      isStaleContact: isStale,
    });

    tasksToCreate.push({
      id: createId(),
      entity_id: entityId,
      canonical_id: snap.invoices.canonical_id,
      invoice_id: snap.invoice_id,
      source_snapshot_id: snapshotId,
      source_type: collection_task_source_type.SUGGESTED,
      reason_code: reasonCode,
      priority_score: priority,
      status: collection_task_status.SUGGESTED,
      created_by: publishedBy,
    });

    countsByReason[reasonCode] = (countsByReason[reasonCode] ?? 0) + 1;
  }

  for (const snap of invoiceSnaps) {
    const outstanding = Number(snap.outstanding_amount);
    if (outstanding <= 0) continue;

    const canonicalId = snap.invoices.canonical_id;
    const hasBrokenPtp = brokenPtpInvoiceIds.has(snap.invoice_id);
    const hasOpenDispute = openDisputeInvoiceIds.has(snap.invoice_id);
    const isStale = staleCanonicalIds.has(canonicalId);

    // Rule: 90+ bucket — bucket values from ageingBucket() in snapshots/service.ts
    if (snap.bucket === "90_PLUS") {
      addTask(snap, collection_task_reason_code.NINETY_PLUS, hasBrokenPtp, hasOpenDispute, isStale);
    }

    // Rule: high value
    if (outstanding >= HIGH_VALUE_THRESHOLD) {
      addTask(snap, collection_task_reason_code.HIGH_VALUE, hasBrokenPtp, hasOpenDispute, isStale);
    }

    // Rule: stale follow-up
    if (isStale) {
      addTask(snap, collection_task_reason_code.STALE_FOLLOW_UP, hasBrokenPtp, hasOpenDispute, isStale);
    }

    // Rule: open dispute
    if (hasOpenDispute) {
      addTask(snap, collection_task_reason_code.DISPUTE_OPEN, hasBrokenPtp, hasOpenDispute, isStale);
    }

    // Rule: broken PTP
    if (hasBrokenPtp) {
      addTask(snap, collection_task_reason_code.BROKEN_PROMISE, hasBrokenPtp, hasOpenDispute, isStale);
    }
  }

  // ── 7. Bulk insert ───────────────────────────────────────────────────────
  if (tasksToCreate.length > 0) {
    await tx.collection_tasks.createMany({ data: tasksToCreate });
  }

  return { total: tasksToCreate.length, by_reason_code: countsByReason };
}
