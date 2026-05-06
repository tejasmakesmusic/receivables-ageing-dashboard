import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { getDigestEvent } from "@/server/digest/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Digest events are Admin-only
    const user = await requireRole(role_enum.ADMIN);
    assertNotPending(user);

    const { id } = await params;
    const event = await getDigestEvent(id);
    return NextResponse.json(event);
  } catch (error) {
    return toErrorResponse(error);
  }
}
