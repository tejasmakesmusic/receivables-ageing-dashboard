import { z } from "zod";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { HttpError } from "@/server/core/errors";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";

/**
 * PR 3 / Gap 3 — bulk-acknowledge field changes captured during a snapshot
 * publish. An acknowledged change drops out of the "Changed Since Last
 * Upload" tab but remains on the invoice's history.
 */
export const acknowledgeChangesSchema = z.object({
  change_ids: z.array(z.string().uuid()).min(1).max(500),
});
export type AcknowledgeChangesInput = z.infer<typeof acknowledgeChangesSchema>;

export interface AcknowledgeChangesResponse {
  acknowledged: number;
  already_acknowledged: number;
  skipped_inaccessible: number;
}

export async function acknowledgeInvoiceChanges(
  body: AcknowledgeChangesInput,
  currentUser: AuthenticatedUser,
): Promise<AcknowledgeChangesResponse> {
  const prisma = getPrisma();

  // Pull the change rows + the invoice's entity_id so we can RBAC-check.
  // (Analysts must own the entity; CFO/Admin pass through.)
  const rows = await prisma.invoice_changes.findMany({
    where: { id: { in: body.change_ids } },
    select: {
      id: true,
      acknowledged_at: true,
      invoices: { select: { entity_id: true } },
    },
  });

  let alreadyAcked = 0;
  let skipped = 0;
  const eligibleIds: string[] = [];

  for (const row of rows) {
    if (row.acknowledged_at) {
      alreadyAcked += 1;
      continue;
    }
    try {
      await assertAnalystCanAccessEntity(currentUser, row.invoices.entity_id);
    } catch {
      skipped += 1;
      continue;
    }
    eligibleIds.push(row.id);
  }

  // Bonus: any change_ids the caller passed that don't exist at all are
  // counted as "skipped" so callers can sanity-check totals.
  const missing = body.change_ids.length - rows.length;
  if (missing > 0) skipped += missing;

  if (eligibleIds.length === 0) {
    return {
      acknowledged: 0,
      already_acknowledged: alreadyAcked,
      skipped_inaccessible: skipped,
    };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.invoice_changes.updateMany({
      where: { id: { in: eligibleIds }, acknowledged_at: null },
      data: { acknowledged_at: now, acknowledged_by: currentUser.id },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "invoice_change.acknowledge",
        entity_type: "invoice_changes",
        entity_id: null,
        after: {
          change_ids: eligibleIds,
          acknowledged_count: eligibleIds.length,
        },
      },
    });
  });

  return {
    acknowledged: eligibleIds.length,
    already_acknowledged: alreadyAcked,
    skipped_inaccessible: skipped,
  };
}

export async function listInvoiceChanges(
  invoiceId: string,
  currentUser: AuthenticatedUser,
): Promise<
  Array<{
    id: string;
    field: string;
    before_value: unknown;
    after_value: unknown;
    detected_at: string;
    snapshot_id: string;
    acknowledged_at: string | null;
  }>
> {
  const prisma = getPrisma();
  const invoice = await prisma.invoices.findUnique({
    where: { id: invoiceId },
    select: { entity_id: true },
  });
  if (!invoice) {
    throw new HttpError("not_found", 404, "Invoice not found");
  }
  await assertAnalystCanAccessEntity(currentUser, invoice.entity_id);

  const rows = await prisma.invoice_changes.findMany({
    where: { invoice_id: invoiceId },
    orderBy: { detected_at: "desc" },
    select: {
      id: true,
      field: true,
      before_value: true,
      after_value: true,
      detected_at: true,
      snapshot_id: true,
      acknowledged_at: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    field: r.field,
    before_value: r.before_value,
    after_value: r.after_value,
    detected_at: r.detected_at.toISOString(),
    snapshot_id: r.snapshot_id,
    acknowledged_at: r.acknowledged_at ? r.acknowledged_at.toISOString() : null,
  }));
}
