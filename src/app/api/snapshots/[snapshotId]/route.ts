import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { getSnapshotDetail } from "@/server/snapshots/service";

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
      role_enum.ADMIN,
    );
    const { snapshotId } = await params;
    const parsedId = snapshotIdSchema.parse(snapshotId);
    const response = await getSnapshotDetail(parsedId, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
