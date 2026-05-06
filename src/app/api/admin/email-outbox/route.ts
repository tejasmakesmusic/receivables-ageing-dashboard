import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  listEmailOutbox,
  parseEmailOutboxListQuery,
} from "@/server/admin/emailOutbox";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const query = parseEmailOutboxListQuery(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await listEmailOutbox(query, currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
