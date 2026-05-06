import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum, promise_to_pay_status } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listPromisesToPay, createPromiseToPay } from "@/server/promises-to-pay/service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  canonical_id: z.string().uuid(),
  invoice_id: z.string().uuid().optional(),
  collection_task_id: z.string().uuid().optional(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  promised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contact_person: z.string().max(255).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const user = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    assertNotPending(user);

    const params = request.nextUrl.searchParams;
    const statusRaw = params.get("status");
    const statusParsed = statusRaw
      ? z.nativeEnum(promise_to_pay_status).safeParse(statusRaw)
      : null;
    if (statusParsed && !statusParsed.success) {
      return NextResponse.json(
        { error: "validation_error", detail: `Invalid status: ${statusRaw}` },
        { status: 400 },
      );
    }
    const response = await listPromisesToPay(
      {
        canonical_id: params.get("canonical_id") ?? undefined,
        invoice_id: params.get("invoice_id") ?? undefined,
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

    const ptp = await createPromiseToPay(parsed.data, user);
    return NextResponse.json(ptp, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
