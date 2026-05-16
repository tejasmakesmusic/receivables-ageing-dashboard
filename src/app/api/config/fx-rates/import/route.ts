import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import {
  importExchangeRateApiFxRate,
  parseFxRateImportBody,
} from "@/server/config/fxRateImport";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsed = parseFxRateImportBody(body);
    const response = await importExchangeRateApiFxRate(parsed, currentUser);
    return NextResponse.json(response, {
      status: response.status === "created" ? 201 : 200,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
