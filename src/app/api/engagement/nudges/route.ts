import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { toErrorResponse } from "@/server/core/errors";
import { buildNudges } from "@/server/engagement/nudges";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    assertNotPending(currentUser);

    const nudges = await buildNudges(currentUser);
    return NextResponse.json({ items: nudges, total: nudges.length });
  } catch (error) {
    return toErrorResponse(error);
  }
}
