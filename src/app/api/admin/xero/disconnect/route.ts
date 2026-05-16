import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { disconnectXeroConnection } from "@/server/xero/connections";

export const dynamic = "force-dynamic";

const schema = z.object({ connection_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const body = schema.parse(await request.json());
    const row = await disconnectXeroConnection({
      connectionId: body.connection_id,
      currentUser,
    });
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
