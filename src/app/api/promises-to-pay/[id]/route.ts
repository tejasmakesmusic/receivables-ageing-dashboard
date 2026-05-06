import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum, promise_to_pay_status } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { getPromiseToPay, patchPromiseToPay } from "@/server/promises-to-pay/service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.nativeEnum(promise_to_pay_status).optional(),
  notes: z.string().max(2000).optional(),
  contact_person: z.string().max(255).optional(),
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
    const ptp = await getPromiseToPay(id, user);
    return NextResponse.json(ptp);
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

    const ptp = await patchPromiseToPay(id, parsed.data, user);
    return NextResponse.json(ptp);
  } catch (error) {
    return toErrorResponse(error);
  }
}
