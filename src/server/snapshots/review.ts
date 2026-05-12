import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";

/**
 * PR 7 — REVIEWER role.
 *
 * REVIEWER (and ADMIN) may review a STAGED snapshot. The review is
 * captured on the snapshot row (`reviewed_by`, `reviewed_at`,
 * `review_decision`, `review_note`) and surfaces in the staging UI as a
 * "Reviewed by X" badge. PR 7a does NOT block publish on review — that's a
 * follow-up (PR 7b) gated by a per-entity flag once the workflow is
 * confirmed in production.
 */
export const reviewSnapshotSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(2000).optional(),
});
export type ReviewSnapshotInput = z.infer<typeof reviewSnapshotSchema>;

export interface ReviewSnapshotResponse {
  snapshot_id: string;
  reviewed_at: string;
  reviewed_by: string;
  decision: "APPROVED" | "REJECTED";
  note: string | null;
}

export async function reviewSnapshot(
  snapshotId: string,
  body: ReviewSnapshotInput,
  currentUser: AuthenticatedUser,
): Promise<ReviewSnapshotResponse> {
  if (
    currentUser.role !== role_enum.REVIEWER &&
    currentUser.role !== role_enum.ADMIN
  ) {
    throw new ForbiddenError(
      "Only REVIEWER or ADMIN users may review snapshots",
    );
  }

  const prisma = getPrisma();
  const snapshot = await prisma.snapshots.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      entity_id: true,
      status: true,
      reviewed_at: true,
      uploaded_by: true,
    },
  });
  if (!snapshot) {
    throw new HttpError("not_found", 404, "Snapshot not found");
  }
  // REVIEWER is global (no entityIdScope check); analyst-scope assertion is
  // only meaningful for ANALYSTs, but we still call it for symmetry — it's
  // a no-op for any non-ANALYST role.
  await assertAnalystCanAccessEntity(currentUser, snapshot.entity_id);

  if (snapshot.status !== "STAGED") {
    throw new HttpError(
      "snapshot_not_staged",
      409,
      "Only STAGED snapshots can be reviewed",
    );
  }
  // A reviewer cannot review their own upload (separation of duties).
  if (snapshot.uploaded_by === currentUser.id) {
    throw new HttpError(
      "self_review_forbidden",
      403,
      "You cannot review a snapshot you uploaded",
    );
  }

  const now = new Date();
  const before = {
    reviewed_at: snapshot.reviewed_at,
    review_decision: null as string | null,
  };
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.snapshots.update({
      where: { id: snapshotId },
      data: {
        reviewed_at: now,
        reviewed_by: currentUser.id,
        review_decision: body.decision,
        review_note: body.note ?? null,
        updated_at: now,
      },
      select: {
        id: true,
        reviewed_at: true,
        reviewed_by: true,
        review_decision: true,
        review_note: true,
      },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "snapshot.review",
        entity_type: "snapshots",
        entity_id: snapshotId,
        before,
        after: {
          decision: body.decision,
          note: body.note ?? null,
        },
      },
    });
    return updated;
  });

  return {
    snapshot_id: result.id,
    reviewed_at: result.reviewed_at!.toISOString(),
    reviewed_by: result.reviewed_by!,
    decision: result.review_decision as "APPROVED" | "REJECTED",
    note: result.review_note,
  };
}
