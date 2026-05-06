import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";

export async function createAuditLog(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  const payload: Prisma.audit_logCreateInput = {
    id: createId(),
    action,
    entity_type: entityType,
    entity_id: entityId,
    users: {
      connect: {
        id: actorUserId,
      },
    },
  };

  if (before !== undefined) {
    payload.before = before as Prisma.InputJsonValue;
  }

  if (after !== undefined) {
    payload.after = after as Prisma.InputJsonValue;
  }

  await getPrisma().audit_log.create({
    data: payload,
  });
}
