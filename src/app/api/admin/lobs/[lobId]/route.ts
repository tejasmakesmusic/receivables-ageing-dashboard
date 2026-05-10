import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { updateLob, updateLobSchema } from "@/server/lobs/service";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ lobId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { lobId } = await params;
    const body = updateLobSchema.parse(await request.json());
    const row = await updateLob(idSchema.parse(lobId), body, currentUser);
    return NextResponse.json(row);
  } catch (error) {
    return toErrorResponse(error);
  }
}
