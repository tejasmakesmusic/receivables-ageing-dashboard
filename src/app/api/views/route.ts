import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { HttpError } from "@/server/core/errors";
import {
  SAVED_VIEW_SURFACES,
  createSavedView,
  listSavedViews,
  type Surface,
} from "@/server/views/user-views";

export const dynamic = "force-dynamic";

const sortSchema = z.object({
  key: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
});

const groupingSchema = z.object({
  key: z.string().min(1),
});

const savedViewInputSchema = z
  .object({
    surface: z.enum(SAVED_VIEW_SURFACES),
    name: z.string(),
    visibility: z.enum(["PRIVATE", "PUBLIC"]),
    filters: z.record(z.unknown()),
    sort: sortSchema.nullable().optional(),
    visible_columns: z.array(z.string()).optional(),
    grouping: groupingSchema.nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

type ApiError = {
  code: string;
  message: string;
  status: number;
};

function requestId(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? randomUUID();
}

function successResponse<T>(
  data: T,
  request_id: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { success: true, data, error: null, request_id },
    { status },
  );
}

function errorResponse(error: unknown, request_id: string): NextResponse {
  const apiError: ApiError =
    error instanceof HttpError
      ? { code: error.code, message: error.message, status: error.status }
      : error instanceof Error
        ? {
            code: "internal_server_error",
            message: error.message,
            status: 500,
          }
        : {
            code: "internal_server_error",
            message: "Unexpected saved view API failure",
            status: 500,
          };

  return NextResponse.json(
    { success: false, data: null, error: apiError, request_id },
    { status: apiError.status },
  );
}

export async function GET(request: NextRequest) {
  const request_id = requestId(request);

  try {
    const user = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    assertNotPending(user);

    const surface = request.nextUrl.searchParams.get("surface") ?? undefined;
    const views = await listSavedViews({ surface: surface as Surface }, user);

    return successResponse(views, request_id);
  } catch (error) {
    return errorResponse(error, request_id);
  }
}

export async function POST(request: NextRequest) {
  const request_id = requestId(request);

  try {
    const user = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    assertNotPending(user);

    const parsed = savedViewInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(
        new HttpError("validation_error", 400, parsed.error.message),
        request_id,
      );
    }

    const view = await createSavedView(parsed.data, user);

    return successResponse(view, request_id, 201);
  } catch (error) {
    return errorResponse(error, request_id);
  }
}
