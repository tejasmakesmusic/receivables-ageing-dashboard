import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { getDashboard } from "@/server/dashboard/service";
import type { DashboardEntity } from "@/server/dashboard/types";
import { DashboardError } from "@/server/dashboard/types";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertAnalystCanAccessEntityCode } from "@/server/core/scope";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const entity = (params.get("entity") as DashboardEntity | null) ?? "IND";
  const asOf = params.get("as_of") ?? "latest";

  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    await assertAnalystCanAccessEntityCode(currentUser, entity);

    const response = await getDashboard({ entity, as_of: asOf });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof DashboardError) {
      return NextResponse.json(
        { detail: error.detail },
        { status: error.status },
      );
    }

    return toErrorResponse(error);
  }
}
