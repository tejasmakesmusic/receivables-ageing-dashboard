import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum, dispute_case_status } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listDisputeCases, createDisputeCase } from "@/server/dispute-cases/service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  entity_id: z.string().uuid(),
  canonical_id: z.string().uuid(),
  invoice_id: z.string().uuid().optional(),
  reason_code: z.string().min(1).max(64),
  description: z.string().min(1).max(4000),
  owner_user_id: z.string().uuid().optional(),
  expected_resolution_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    assertNotPending(user);

    const params = request.nextUrl.searchParams;
    const statusRaw = params.get("status");
    const statusParsed = statusRaw
      ? z.nativeEnum(dispute_case_status).safeParse(statusRaw)
      : null;
    if (statusParsed && !statusParsed.success) {
      return NextResponse.json(
        { error: "validation_error", detail: `Invalid status: ${statusRaw}` },
        { status: 400 },
      );
    }
    const response = await listDisputeCases(
      {
        entity_id: params.get("entity_id") ?? undefined,
        canonical_id: params.get("canonical_id") ?? undefined,
        status: statusParsed?.data,
        page: params.get("page") ? Number(params.get("page")) : undefined,
        page_size: params.get("page_size")
          ? Number(params.get("page_size"))
          : undefined,
      },
      user,
    );

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    assertNotPending(user);

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", detail: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const dispute = await createDisputeCase(parsed.data, user);
    return NextResponse.json(dispute, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
