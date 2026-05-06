import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  createExceptionForInvoice,
  exceptionCreateSchema,
} from "@/server/exceptions/service";

export const dynamic = "force-dynamic";

const invoiceIdSchema = z.string().uuid("Invalid invoice ID");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const { invoiceId } = await params;
    const parsedInvoiceId = invoiceIdSchema.parse(invoiceId);
    const body = exceptionCreateSchema.parse(await request.json());
    const response = await createExceptionForInvoice(
      parsedInvoiceId,
      body,
      currentUser,
    );

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
