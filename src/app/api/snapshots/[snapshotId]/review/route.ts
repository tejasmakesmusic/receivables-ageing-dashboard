import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  reviewSnapshot,
  reviewSnapshotSchema,
} from "@/server/snapshots/review";

export const dynamic = "force-dynamic";

const snapshotIdSchema = z.string().uuid();

/**
 * PR 7 — REVIEWER (or ADMIN) approves/rejects a STAGED snapshot.
 *
 * POST body: { decision: 'APPROVED' | 'REJECTED', note?: string }
 *
 * Notes:
 * - REVIEWER cannot review their own uploads (separation of duties).
 * - Captures decision + note + actor on the snapshot row and audit log.
 * - Does NOT block publish — analysts/admins can still publish; PR 7b will
 *   add a per-entity hard gate when ops sign off.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.REVIEWER, role_enum.ADMIN);
    const { snapshotId } = await params;
    const body = reviewSnapshotSchema.parse(await request.json());
    const response = await reviewSnapshot(
      snapshotIdSchema.parse(snapshotId),
      body,
      currentUser,
    );
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
