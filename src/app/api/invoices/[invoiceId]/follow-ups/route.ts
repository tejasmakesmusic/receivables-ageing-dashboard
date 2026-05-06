import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError } from "@/server/core/errors";
import { toErrorResponse } from "@/server/core/errors";
import {
  createInvoiceFollowUp,
  parseFollowUpCreateBody,
} from "@/server/follow-ups/service";

const invoiceIdSchema = z.string().uuid("Invalid invoice ID");

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { invoiceId } = await params;
    const parsedIdResult = invoiceIdSchema.safeParse(invoiceId);
    if (!parsedIdResult.success) {
      throw new HttpError(
        "validation_error",
        400,
        parsedIdResult.error.issues[0]?.message ?? "Invalid invoice ID",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const payload = parseFollowUpCreateBody(body);
    const response = await createInvoiceFollowUp(
      parsedIdResult.data,
      payload,
      currentUser,
    );

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
