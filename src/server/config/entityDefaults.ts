import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";

export interface EntityDefaultRow {
  id: string;
  code: string;
  name: string;
  default_credit_days: number | null;
}

export async function listEntityDefaults(
  _currentUser: AuthenticatedUser,
): Promise<EntityDefaultRow[]> {
  const rows = await getPrisma().entities.findMany({
    select: { id: true, code: true, name: true, default_credit_days: true },
    orderBy: { code: "asc" },
  });
  return rows;
}

export async function updateEntityDefault(
  entityId: string,
  defaultCreditDays: number | null,
  currentUser: AuthenticatedUser,
): Promise<EntityDefaultRow> {
  if (
    currentUser.role !== role_enum.ANALYST &&
    currentUser.role !== role_enum.ADMIN
  ) {
    throw new ForbiddenError("Only ANALYST or ADMIN can update entity defaults");
  }

  if (
    defaultCreditDays !== null &&
    (!Number.isInteger(defaultCreditDays) || defaultCreditDays < 0)
  ) {
    throw new HttpError(
      "validation_error",
      422,
      "default_credit_days must be a non-negative integer or null",
    );
  }

  const existing = await getPrisma().entities.findUnique({
    where: { id: entityId },
    select: { id: true, code: true, name: true, default_credit_days: true },
  });
  if (!existing) {
    throw new HttpError("not_found", 404, "Entity not found");
  }

  const updated = await getPrisma().entities.update({
    where: { id: entityId },
    data: { default_credit_days: defaultCreditDays },
    select: { id: true, code: true, name: true, default_credit_days: true },
  });

  await createAuditLog(
    currentUser.id,
    "entity_default_credit_days_updated",
    "entities",
    entityId,
    { default_credit_days: existing.default_credit_days },
    { default_credit_days: updated.default_credit_days },
  );

  return updated;
}
