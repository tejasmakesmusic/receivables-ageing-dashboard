import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  getOrComputeReconciliation,
  reconciliationUpsertSchema,
  upsertReconciliation,
} from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

const snapshotIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const { snapshotId } = await params;
    const parsedId = snapshotIdSchema.parse(snapshotId);
    const response = await getOrComputeReconciliation(parsedId, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { snapshotId } = await params;
    const parsedId = snapshotIdSchema.parse(snapshotId);
    const body = reconciliationUpsertSchema.parse(await request.json());
    const response = await upsertReconciliation(parsedId, body, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
