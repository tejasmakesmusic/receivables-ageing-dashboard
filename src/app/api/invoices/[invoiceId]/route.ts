import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import {
  getInvoiceDetail,
  getInvoiceEntityId,
} from "@/server/invoices/service";

export const dynamic = "force-dynamic";

const invoiceIdSchema = z.string().uuid("Invalid invoice ID");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const { invoiceId } = await params;
    const parsedId = invoiceIdSchema.safeParse(invoiceId);
    if (!parsedId.success) {
      return NextResponse.json(
        { detail: parsedId.error.issues[0]?.message ?? "Invalid invoice ID" },
        { status: 400 },
      );
    }

    const entityId = await getInvoiceEntityId(parsedId.data);
    if (!entityId) {
      return NextResponse.json(
        { detail: "Invoice not found" },
        { status: 404 },
      );
    }

    await assertAnalystCanAccessEntity(currentUser, entityId);

    const invoice = await getInvoiceDetail(parsedId.data);
    if (!invoice) {
      return NextResponse.json(
        { detail: "Invoice not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(invoice);
  } catch (error) {
    return toErrorResponse(error);
  }
}
