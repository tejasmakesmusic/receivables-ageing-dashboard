import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import {
  createCreditPeriod,
  listCreditPeriods,
  parseCreditPeriodCreateBody,
  parseCreditPeriodListQuery,
} from "@/server/config/creditPeriod";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    const query = parseCreditPeriodListQuery(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await listCreditPeriods(query, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsedBody = parseCreditPeriodCreateBody(body);
    const response = await createCreditPeriod(parsedBody, currentUser);

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
