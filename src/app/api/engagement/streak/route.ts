import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { getStreakForUser } from "@/server/engagement/streaks";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );

    const state = await getStreakForUser(currentUser);
    return NextResponse.json(state);
  } catch (error) {
    return toErrorResponse(error);
  }
}
