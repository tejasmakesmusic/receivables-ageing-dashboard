import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import {
  createExceptionBucket,
  listExceptionBuckets,
  parseExceptionBucketCreateBody,
} from "@/server/admin/exceptionBuckets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    const response = await listExceptionBuckets(currentUser);
    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const parsedBody = parseExceptionBucketCreateBody(body);
    const response = await createExceptionBucket(parsedBody, currentUser);
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
