import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  deleteAlias,
  patchAlias,
  parseAliasPatchBody,
} from "@/server/config/aliases";

const aliasIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ aliasId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { aliasId } = await params;
    const parsedId = aliasIdSchema.parse(aliasId);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json(
        { code: "validation_error", message: "Invalid JSON body", status: 400 },
        { status: 400 },
      );
    }
    const payloadBody = parseAliasPatchBody(payload);
    const response = await patchAlias(parsedId, payloadBody, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ aliasId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { aliasId } = await params;
    const parsedId = aliasIdSchema.parse(aliasId);

    await deleteAlias(parsedId, currentUser);

    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
