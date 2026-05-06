import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { approveDigest } from "@/server/digest/service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole(role_enum.ADMIN);
    assertNotPending(user);

    const { id } = await params;
    const event = await approveDigest(id, user.id);
    return NextResponse.json(event);
  } catch (error) {
    return toErrorResponse(error);
  }
}
