import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum, collection_task_status } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import {
  getCollectionTask,
  patchCollectionTask,
} from "@/server/collection-tasks/service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.nativeEnum(collection_task_status).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  dismissed_reason: z.string().min(1).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    assertNotPending(user);

    const { id } = await params;
    const task = await getCollectionTask(id, user);
    return NextResponse.json(task);
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
    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { code: "validation_error", message: body.error.message, status: 400 },
        { status: 400 },
      );
    }

    const task = await patchCollectionTask(id, body.data, user);
    return NextResponse.json(task);
  } catch (error) {
    return toErrorResponse(error);
  }
}
