import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { reactivateUser } from "@/server/admin/users";

const userIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { userId } = await params;
    const parsedId = userIdSchema.parse(userId);
    const response = await reactivateUser(parsedId, currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
