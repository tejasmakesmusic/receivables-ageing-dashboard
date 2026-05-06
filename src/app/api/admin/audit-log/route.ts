import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { listAuditLog, parseAuditLogQuery } from "@/server/admin/auditLog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const query = parseAuditLogQuery(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await listAuditLog(query, currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
