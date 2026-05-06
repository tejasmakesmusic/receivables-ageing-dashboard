import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum, dispute_case_status } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { getDisputeCase, patchDisputeCase } from "@/server/dispute-cases/service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.nativeEnum(dispute_case_status).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  expected_resolution_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  resolution_note: z.string().min(1).max(4000).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    assertNotPending(user);

    const { id } = await params;
    const dispute = await getDisputeCase(id, user);
    return NextResponse.json(dispute);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    assertNotPending(user);

    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", detail: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const dispute = await patchDisputeCase(id, parsed.data, user);
    return NextResponse.json(dispute);
  } catch (error) {
    return toErrorResponse(error);
  }
}
