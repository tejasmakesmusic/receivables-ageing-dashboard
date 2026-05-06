import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import {
  parseCreditPeriodPatchBody,
  patchCreditPeriod,
} from "@/server/config/creditPeriod";

const configIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ configId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { configId } = await params;
    const parsedId = configIdSchema.parse(configId);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsedBody = parseCreditPeriodPatchBody(body);
    const response = await patchCreditPeriod(parsedId, parsedBody, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  return NextResponse.json(
    {
      detail:
        "DELETE is not supported for credit-period config. Config rows are versioned.",
    },
    { status: 405, headers: { Allow: "GET, POST, PATCH" } },
  );
}
