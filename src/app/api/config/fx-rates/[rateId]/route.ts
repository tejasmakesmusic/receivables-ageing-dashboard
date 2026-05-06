import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertFxImmutable } from "@/server/core/assertFxImmutable";
import { z } from "zod";

const rateIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ rateId: string }> },
) {
  try {
    await requireRole(role_enum.ADMIN);
    const parsedId = rateIdSchema.safeParse((await params).rateId);
    if (!parsedId.success) {
      return NextResponse.json(
        { code: "validation_error", message: "Invalid rate ID", status: 400 },
        { status: 400 },
      );
    }
    assertFxImmutable(); // throws HttpError 405
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ rateId: string }> },
) {
  try {
    await requireRole(role_enum.ADMIN);
    const parsedId = rateIdSchema.safeParse((await params).rateId);
    if (!parsedId.success) {
      return NextResponse.json(
        { code: "validation_error", message: "Invalid rate ID", status: 400 },
        { status: 400 },
      );
    }
    void parsedId;
    assertFxImmutable(); // throws HttpError 405
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET() {
  return NextResponse.json(
    {
      detail: "This endpoint is immutable. Use GET /config/fx-rates.",
    },
    {
      status: 405,
      headers: { Allow: "GET, POST" },
    },
  );
}
