import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum, collection_task_reason_code } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import {
  listCollectionTasks,
  createCollectionTask,
} from "@/server/collection-tasks/service";
import type { collection_task_status } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  entity_id: z.string().uuid(),
  canonical_id: z.string().uuid(),
  invoice_id: z.string().uuid().optional(),
  reason_code: z.nativeEnum(collection_task_reason_code),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
    const response = await listCollectionTasks(
      {
        entity_id: params.get("entity_id") ?? undefined,
        canonical_id: params.get("canonical_id") ?? undefined,
        status: (params.get("status") as collection_task_status) ?? undefined,
        owner_user_id: params.get("owner_user_id") ?? undefined,
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

    const body = createSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { code: "validation_error", message: body.error.message, status: 400 },
        { status: 400 },
      );
    }

    const task = await createCollectionTask(body.data, user);
    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
