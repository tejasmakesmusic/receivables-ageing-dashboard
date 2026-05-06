import { NextResponse } from "next/server";
import { toErrorResponse } from "@/server/core/errors";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import {
  markEmailOutboxSent,
  parseEmailOutboxMarkSentBody,
} from "@/server/admin/emailOutbox";

const outboxIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ outboxId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { outboxId } = await params;
    const parsedId = outboxIdSchema.parse(outboxId);

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // allow empty body
      body = {};
    }

    const parsedBody = parseEmailOutboxMarkSentBody(body);
    const response = await markEmailOutboxSent(
      parsedId,
      parsedBody,
      currentUser,
    );
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
