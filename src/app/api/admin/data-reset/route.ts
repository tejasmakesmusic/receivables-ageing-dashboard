import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import {
  getImportedDataResetPreview,
  resetImportedReceivablesData,
} from "@/server/admin/dataReset";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";

export const dynamic = "force-dynamic";

const dataResetSchema = z.object({
  confirmation: z.string(),
});

export async function GET() {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const preview = await getImportedDataResetPreview(currentUser);

    return NextResponse.json(preview);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    let json: unknown;

    try {
      json = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsed = dataResetSchema.safeParse(json);
    if (!parsed.success) {
      throw new HttpError("validation_error", 400, parsed.error.message);
    }

    const result = await resetImportedReceivablesData(
      parsed.data,
      currentUser,
    );

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
