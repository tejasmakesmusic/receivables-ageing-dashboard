import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { autoCreateCanonicals } from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

const snapshotIdSchema = z.string().uuid();

const bodySchema = z.object({
  row_indices: z.array(z.number().int()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { snapshotId } = await params;
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await autoCreateCanonicals(
      snapshotIdSchema.parse(snapshotId),
      currentUser,
      { row_indices: body.row_indices },
    );
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
