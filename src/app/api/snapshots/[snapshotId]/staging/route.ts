import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { getStagingView, stagingQuerySchema } from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

const snapshotIdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { snapshotId } = await params;
    const query = stagingQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await getStagingView(
      snapshotIdSchema.parse(snapshotId),
      query,
      currentUser,
    );

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
