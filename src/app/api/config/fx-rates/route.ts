import { NextRequest, NextResponse } from "next/server";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import {
  createFxRate,
  listFxRates,
  parseFxRateCreateBody,
  parseFxRateListQuery,
} from "@/server/config/fxRates";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    const query = parseFxRateListQuery(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const response = await listFxRates(query, currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsedBody = parseFxRateCreateBody(body);
    const response = await createFxRate(parsedBody, currentUser);
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
