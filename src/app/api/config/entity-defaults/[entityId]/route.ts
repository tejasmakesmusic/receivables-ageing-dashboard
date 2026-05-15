import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { role_enum } from "@/generated/prisma/enums";
import { updateEntityDefault } from "@/server/config/entityDefaults";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.ADMIN,
    );
    const { entityId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const raw = body as Record<string, unknown>;
    const rawDays = raw.default_credit_days;

    let defaultCreditDays: number | null;
    if (rawDays === null || rawDays === undefined) {
      defaultCreditDays = null;
    } else if (typeof rawDays === "number") {
      defaultCreditDays = rawDays;
    } else {
      throw new HttpError(
        "validation_error",
        422,
        "default_credit_days must be a number or null",
      );
    }

    const updated = await updateEntityDefault(
      entityId,
      defaultCreditDays,
      currentUser,
    );
    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
