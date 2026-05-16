import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { pullXeroSnapshot } from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  connection_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const body = schema.parse(await request.json().catch(() => ({})));
    const response = await pullXeroSnapshot({
      currentUser,
      connectionId: body.connection_id,
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
