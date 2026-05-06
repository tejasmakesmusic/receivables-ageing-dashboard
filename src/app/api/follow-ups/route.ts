import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  parseFollowUpListQuery,
  listFollowUps,
} from "@/server/follow-ups/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    const params = request.nextUrl.searchParams;

    const query = parseFollowUpListQuery({
      entity: params.get("entity") ?? undefined,
      channel: params.get("channel") ?? undefined,
      canonical_id: params.get("canonical_id") ?? undefined,
      invoice_id: params.get("invoice_id") ?? undefined,
      page: params.get("page") ?? undefined,
      page_size: params.get("page_size") ?? undefined,
    });

    const response = await listFollowUps(query, currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
