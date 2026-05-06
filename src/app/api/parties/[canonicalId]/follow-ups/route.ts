import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError } from "@/server/core/errors";
import { toErrorResponse } from "@/server/core/errors";
import {
  createPartyFollowUp,
  parseFollowUpCreateBody,
} from "@/server/follow-ups/service";

const canonicalIdSchema = z.string().uuid("Invalid canonical ID");

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ canonicalId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { canonicalId } = await params;
    const parsedIdResult = canonicalIdSchema.safeParse(canonicalId);
    if (!parsedIdResult.success) {
      throw new HttpError(
        "validation_error",
        400,
        parsedIdResult.error.issues[0]?.message ?? "Invalid canonical ID",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const payload = parseFollowUpCreateBody(body);
    const response = await createPartyFollowUp(
      parsedIdResult.data,
      payload,
      currentUser,
    );

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
