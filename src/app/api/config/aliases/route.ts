import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import {
  createAlias,
  listAliases,
  parseAliasCreateBody,
  parseAliasListQuery,
} from "@/server/config/aliases";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const query = parseAliasListQuery(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const response = await listAliases(query, currentUser);
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

    const parsedBody = parseAliasCreateBody(body);
    const response = await createAlias(parsedBody, currentUser);

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
