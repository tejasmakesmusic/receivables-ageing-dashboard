import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { getEmailRule, patchEmailRule } from "@/server/admin/emailRules";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  is_active: z.boolean().optional(),
  recipients_json: z
    .array(z.string().email("Each recipient must be a valid email"))
    .optional(),
  cron_schedule: z.string().max(64).optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const user = await requireRole(role_enum.ADMIN);
    assertNotPending(user);

    const { ruleId } = await params;
    const rule = await getEmailRule(ruleId, user);
    return NextResponse.json(rule);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> },
) {
  try {
    const user = await requireRole(role_enum.ADMIN);
    assertNotPending(user);

    const { ruleId } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", detail: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const rule = await patchEmailRule(ruleId, parsed.data, user);
    return NextResponse.json(rule);
  } catch (error) {
    return toErrorResponse(error);
  }
}
