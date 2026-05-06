import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { assertReadOnlyForCfo } from "@/server/core/assertReadOnlyForCfo";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import {
  role_enum,
  collection_task_status,
  collection_task_source_type,
  collection_task_reason_code,
} from "@/generated/prisma/enums";

export interface CollectionTaskListQuery {
  entity_id?: string;
  canonical_id?: string;
  status?: collection_task_status;
  statuses?: readonly collection_task_status[];
  reason_code?: collection_task_reason_code;
  reason_codes?: readonly collection_task_reason_code[];
  owner_user_id?: string;
  due_date_on_or_before?: Date;
  page?: number;
  page_size?: number;
}

export interface CreateCollectionTaskInput {
  entity_id: string;
  canonical_id: string;
  invoice_id?: string;
  reason_code: collection_task_reason_code;
  due_date?: string; // YYYY-MM-DD
  notes?: string;
}

export interface PatchCollectionTaskInput {
  status?: collection_task_status;
  owner_user_id?: string | null;
  due_date?: string | null;
  dismissed_reason?: string;
  snooze_until?: string; // ISO date, sets due_date for SNOOZED
}

// Valid analyst/admin-driven transitions
const ALLOWED_TRANSITIONS: Record<collection_task_status, collection_task_status[]> = {
  [collection_task_status.SUGGESTED]: [
    collection_task_status.OPEN,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.OPEN]: [
    collection_task_status.IN_PROGRESS,
    collection_task_status.SNOOZED,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.IN_PROGRESS]: [
    collection_task_status.DONE,
    collection_task_status.SNOOZED,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.SNOOZED]: [
    collection_task_status.OPEN,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.DONE]: [],
  [collection_task_status.DISMISSED]: [],
};

export async function listCollectionTasks(
  query: CollectionTaskListQuery,
  user: AuthenticatedUser,
) {
  const {
    due_date_on_or_before,
    entity_id,
    canonical_id,
    owner_user_id,
    page = 1,
    page_size = 50,
    reason_code,
    reason_codes,
    status,
    statuses,
  } = query;

  // Analysts must have an entity scope — reject immediately if missing
  if (user.role === role_enum.ANALYST) {
    if (!user.entityIdScope) {
      throw new ForbiddenError("Analyst user has no entity scope");
    }
    if (entity_id) {
      await assertAnalystCanAccessEntity(user, entity_id);
    }
  }

  const where: Prisma.collection_tasksWhereInput = {
    ...(entity_id ? { entity_id } : {}),
    ...(canonical_id ? { canonical_id } : {}),
    ...(statuses?.length
      ? { status: { in: [...statuses] } }
      : status
        ? { status }
        : {}),
    ...(reason_codes?.length
      ? { reason_code: { in: [...reason_codes] } }
      : reason_code
        ? { reason_code }
        : {}),
    ...(owner_user_id ? { owner_user_id } : {}),
    ...(due_date_on_or_before
      ? { due_date: { lte: due_date_on_or_before } }
      : {}),
    // Analysts with no explicit entity filter are scoped to their assigned entity
    ...(user.role === role_enum.ANALYST && !entity_id
      ? { entity_id: user.entityIdScope! }
      : {}),
  };

  const [items, total] = await getPrisma().$transaction([
    getPrisma().collection_tasks.findMany({
      where,
      orderBy: [{ priority_score: "desc" }, { created_at: "desc" }],
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    getPrisma().collection_tasks.count({ where }),
  ]);

  return { items, total, page, page_size };
}

export async function getCollectionTask(id: string, user: AuthenticatedUser) {
  const task = await getPrisma().collection_tasks.findUnique({ where: { id } });

  if (!task) {
    throw new HttpError("not_found", 404, "Collection task not found");
  }

  await assertAnalystCanAccessEntity(user, task.entity_id);

  return task;
}

export async function createCollectionTask(
  input: CreateCollectionTaskInput,
  user: AuthenticatedUser,
) {
  assertReadOnlyForCfo(user);
  await assertAnalystCanAccessEntity(user, input.entity_id);

  const id = createId();
  const now = new Date();

  const task = await getPrisma().$transaction(async (tx) => {
    const created = await tx.collection_tasks.create({
      data: {
        id,
        entity_id: input.entity_id,
        canonical_id: input.canonical_id,
        invoice_id: input.invoice_id ?? null,
        source_type: collection_task_source_type.MANUAL,
        reason_code: input.reason_code,
        priority_score: 50, // Default mid-priority for manual tasks
        status: collection_task_status.OPEN,
        created_by: user.id,
        due_date: input.due_date ? new Date(input.due_date) : null,
        created_at: now,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action: "collection_task.create",
        entity_type: "collection_tasks",
        entity_id: id,
        after: {
          reason_code: input.reason_code,
          entity_id: input.entity_id,
          canonical_id: input.canonical_id,
          invoice_id: input.invoice_id ?? null,
        },
      },
    });

    return created;
  });

  return task;
}

export async function patchCollectionTask(
  id: string,
  input: PatchCollectionTaskInput,
  user: AuthenticatedUser,
) {
  assertReadOnlyForCfo(user);

  const task = await getPrisma().collection_tasks.findUnique({ where: { id } });
  if (!task) {
    throw new HttpError("not_found", 404, "Collection task not found");
  }

  await assertAnalystCanAccessEntity(user, task.entity_id);

  // Validate status transition if requested
  if (input.status && input.status !== task.status) {
    const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new HttpError(
        "invalid_transition",
        422,
        `Cannot transition from ${task.status} to ${input.status}`,
      );
    }
    if (
      input.status === collection_task_status.DISMISSED &&
      !input.dismissed_reason
    ) {
      throw new HttpError(
        "dismissed_reason_required",
        422,
        "dismissed_reason is required when dismissing a task",
      );
    }
  }

  const now = new Date();
  const completedAt =
    input.status === collection_task_status.DONE ? now : task.completed_at;

  // snooze_until sets due_date when transitioning to SNOOZED
  const effectiveDueDate: Date | null | undefined = (() => {
    if (
      input.status === collection_task_status.SNOOZED &&
      input.snooze_until
    ) {
      return new Date(input.snooze_until);
    }
    if (input.due_date !== undefined) {
      return input.due_date ? new Date(input.due_date) : null;
    }
    return undefined; // not touched
  })();

  const updated = await getPrisma().$transaction(async (tx) => {
    const result = await tx.collection_tasks.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.owner_user_id !== undefined
          ? { owner_user_id: input.owner_user_id }
          : {}),
        ...(effectiveDueDate !== undefined
          ? { due_date: effectiveDueDate }
          : {}),
        ...(input.dismissed_reason
          ? { dismissed_reason: input.dismissed_reason }
          : {}),
        completed_at: completedAt,
        updated_at: now,
      },
    });

    // Derive audit action: status change takes precedence; owner-only patch = assign
    const action = input.status
      ? input.status === collection_task_status.DONE
        ? "collection_task.complete"
        : input.status === collection_task_status.DISMISSED
          ? "collection_task.dismiss"
          : input.status === collection_task_status.SNOOZED
            ? "collection_task.snooze"
            : "collection_task.status_change"
      : "collection_task.assign";

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action,
        entity_type: "collection_tasks",
        entity_id: id,
        before: { status: task.status, owner_user_id: task.owner_user_id },
        after: {
          status: result.status,
          owner_user_id: result.owner_user_id,
          dismissed_reason: result.dismissed_reason,
        },
      },
    });

    return result;
  });

  return updated;
}
