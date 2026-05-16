import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import {
  bulkCreateCreditPeriod,
  parseCreditPeriodBulkBody,
} from "@/server/config/creditPeriod";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsed = parseCreditPeriodBulkBody(body);
    const result = await bulkCreateCreditPeriod(parsed, currentUser);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
