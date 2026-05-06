import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  exceptionUpdateSchema,
  updateException,
} from "@/server/exceptions/service";

export const dynamic = "force-dynamic";

const exceptionIdSchema = z.string().uuid("Invalid exception ID");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ exceptionId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { exceptionId } = await params;
    const parsedExceptionId = exceptionIdSchema.parse(exceptionId);
    const body = exceptionUpdateSchema.parse(await request.json());
    const response = await updateException(
      parsedExceptionId,
      body,
      currentUser,
    );

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
