import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  patchStagingRow,
  stagingPatchSchema,
} from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

const snapshotIdSchema = z.string().uuid();
const rowIndexSchema = z.coerce.number().int().min(0);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ snapshotId: string; rowIndex: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { snapshotId, rowIndex } = await params;
    const body = stagingPatchSchema.parse(await request.json());
    const response = await patchStagingRow(
      snapshotIdSchema.parse(snapshotId),
      rowIndexSchema.parse(rowIndex),
      body,
      currentUser,
    );

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
