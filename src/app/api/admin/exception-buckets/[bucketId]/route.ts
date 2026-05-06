import { NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  parseExceptionBucketPatchBody,
  patchExceptionBucket,
} from "@/server/admin/exceptionBuckets";

const bucketIdSchema = z.string().uuid();

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bucketId: string }> },
) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const { bucketId } = await params;
    const parsedId = bucketIdSchema.parse(bucketId);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { code: "validation_error", message: "Invalid JSON body", status: 400 },
        { status: 400 },
      );
    }

    const parsedBody = parseExceptionBucketPatchBody(body);

    const response = await patchExceptionBucket(
      parsedId,
      parsedBody,
      currentUser,
    );
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
