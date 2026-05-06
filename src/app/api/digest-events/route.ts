import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listDigestEvents } from "@/server/digest/service";
import type { digest_event_state } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Digest events are Admin-only
    const user = await requireRole(role_enum.ADMIN);
    assertNotPending(user);

    const params = request.nextUrl.searchParams;
    const response = await listDigestEvents({
      state: (params.get("state") as digest_event_state) ?? undefined,
      page: params.get("page") ? Number(params.get("page")) : undefined,
      page_size: params.get("page_size")
        ? Number(params.get("page_size"))
        : undefined,
    });

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
