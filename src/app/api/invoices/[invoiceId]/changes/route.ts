import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { listInvoiceChanges } from "@/server/invoice-changes/service";

export const dynamic = "force-dynamic";

const invoiceIdSchema = z.string().uuid();

/**
 * PR 3 / Gap 3 — list every captured field change for one invoice
 * (newest first), for the side-panel "Changes" section.
 */
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
    const items = await listInvoiceChanges(
      invoiceIdSchema.parse(invoiceId),
      currentUser,
    );
    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}
