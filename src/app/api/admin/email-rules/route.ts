import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listEmailRules } from "@/server/admin/emailRules";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireRole(role_enum.ADMIN);
    assertNotPending(user);

    const rules = await listEmailRules(user);
    return NextResponse.json(rules);
  } catch (error) {
    return toErrorResponse(error);
  }
}
