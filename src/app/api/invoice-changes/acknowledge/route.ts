import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  acknowledgeChangesSchema,
  acknowledgeInvoiceChanges,
} from "@/server/invoice-changes/service";

export const dynamic = "force-dynamic";

/**
 * PR 3 / Gap 3 — bulk-acknowledge invoice_changes rows.
 *
 * POST body: { change_ids: string[] }
 * Returns:   { acknowledged, already_acknowledged, skipped_inaccessible }
 *
 * RBAC: analysts may only acknowledge changes for invoices in their entity
 * scope; CFO is forbidden (read-only); admins pass through.
 */
export async function POST(request: Request) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const body = acknowledgeChangesSchema.parse(await request.json());
    const response = await acknowledgeInvoiceChanges(body, currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
