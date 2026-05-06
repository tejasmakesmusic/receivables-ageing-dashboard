import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { listUsers, parseUserListQuery } from "@/server/admin/users";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireRole(role_enum.ADMIN);
    const query = parseUserListQuery(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await listUsers(query);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
