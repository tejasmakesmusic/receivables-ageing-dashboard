import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { listInvoices } from "@/server/invoices/service";

export const dynamic = "force-dynamic";

const filtersSchema = z.object({
  entity: z.enum(["IND", "UAE"]).optional(),
  status: z.enum(["OPEN", "SETTLED"]).optional(),
  overdue_bucket: z
    .enum(["NOT_DUE", "0_30", "31_60", "61_90", "90_PLUS"])
    .optional(),
  has_active_exceptions: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  party_canonical_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    const filters = filtersSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const response = await listInvoices(filters, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
