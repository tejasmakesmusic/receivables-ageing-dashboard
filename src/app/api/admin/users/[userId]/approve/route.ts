import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { approveUser, parseUserApproveBody } from "@/server/admin/users";

const userIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { userId } = await params;
    const parsedId = userIdSchema.parse(userId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsedBody = parseUserApproveBody(body);
    const response = await approveUser(parsedId, parsedBody, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
