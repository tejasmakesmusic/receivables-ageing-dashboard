import { role_enum } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";

export async function assertAnalystCanAccessEntity(
  user: AuthenticatedUser,
  entityId: string,
): Promise<void> {
  if (user.role !== role_enum.ANALYST) {
    return;
  }

  if (!user.entityIdScope) {
    throw new ForbiddenError("Analyst user has no entity scope");
  }

  if (user.entityIdScope !== entityId) {
    throw new ForbiddenError("Analyst cannot access this entity");
  }
}

export async function assertAnalystCanAccessEntityCode(
  user: AuthenticatedUser,
  entityCode: string,
): Promise<void> {
  if (user.role !== role_enum.ANALYST) {
    return;
  }

  if (entityCode === "ALL") {
    throw new ForbiddenError("Analyst cannot access all entities");
  }

  const entity = await getPrisma().entities.findUnique({
    where: { code: entityCode },
    select: { id: true },
  });

  if (!entity) {
    throw new HttpError("not_found", 404, "Entity not found");
  }

  await assertAnalystCanAccessEntity(user, entity.id);
}
