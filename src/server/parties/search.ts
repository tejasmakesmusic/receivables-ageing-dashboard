import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { role_enum } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/core/errors";
import type { AuthenticatedUser } from "@/server/core/auth";

export interface PartySearchResult {
  id: string;
  name: string;
  entity_code: "IND" | "UAE";
}

export async function searchParties(
  nameContains: string,
  entityCode: "IND" | "UAE" | undefined,
  pageSize: number,
  currentUser: AuthenticatedUser,
): Promise<PartySearchResult[]> {
  const prisma = getPrisma();

  const where: Prisma.parties_canonicalWhereInput = {
    name: { contains: nameContains, mode: "insensitive" },
  };

  if (currentUser.role === role_enum.ANALYST) {
    if (!currentUser.entityIdScope) {
      throw new ForbiddenError("Analyst user has no entity scope");
    }
    where.entity_id = currentUser.entityIdScope;
  }

  if (entityCode && currentUser.role !== role_enum.ANALYST) {
    where.entities = { code: entityCode };
  }

  const rows = await prisma.parties_canonical.findMany({
    where,
    orderBy: { name: "asc" },
    take: pageSize,
    select: {
      id: true,
      name: true,
      entities: { select: { code: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    entity_code: r.entities.code as "IND" | "UAE",
  }));
}
