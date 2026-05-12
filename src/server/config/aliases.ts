import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

export const aliasListQuerySchema = z.object({
  entity_code: z.enum(["IND", "UAE"]).optional(),
  canonical_id: z.string().uuid().optional(),
  alias_text_contains: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const aliasCreateSchema = z.object({
  canonical_id: z.string().uuid("canonical_id must be a valid UUID"),
  alias_text: z.string().trim().min(1),
});

const aliasPatchSchema = z.object({
  alias_text: z.string().trim().min(1),
});

export const aliasListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      canonical_id: z.string().uuid(),
      canonical_name: z.string(),
      entity_code: z.enum(["IND", "UAE"]),
      alias_text: z.string(),
      source: z.string(),
      created_by: z.string().uuid(),
      created_at: z.string(),
    }),
  ),
  pagination: z.object({
    page: z.number(),
    page_size: z.number(),
    total: z.number(),
    total_pages: z.number(),
  }),
});

export const aliasResponseSchema = z.object({
  id: z.string().uuid(),
  canonical_id: z.string().uuid(),
  canonical_name: z.string(),
  entity_code: z.enum(["IND", "UAE"]),
  alias_text: z.string(),
  source: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

type AliasRow = z.infer<typeof aliasResponseSchema>;
export type AliasListQuery = z.infer<typeof aliasListQuerySchema>;
export type AliasListResponse = z.infer<typeof aliasListResponseSchema>;

export type AliasCreateBody = z.infer<typeof aliasCreateSchema>;
export type AliasPatchBody = z.infer<typeof aliasPatchSchema>;

type AliasPayload = Prisma.party_aliasesGetPayload<{
  select: {
    id: true;
    canonical_id: true;
    alias_text: true;
    source: true;
    created_by: true;
    created_at: true;
    parties_canonical: {
      select: {
        id: true;
        name: true;
        entities: {
          select: {
            code: true;
          };
        };
      };
    };
  };
}>;

function toDateTime(value: Date): string {
  return value.toISOString();
}

function toAliasRow(row: AliasPayload): AliasRow {
  return {
    id: row.id,
    canonical_id: row.canonical_id,
    canonical_name: row.parties_canonical.name,
    entity_code: row.parties_canonical.entities.code as "IND" | "UAE",
    alias_text: row.alias_text,
    source: row.source,
    created_by: row.created_by,
    created_at: toDateTime(row.created_at),
  };
}

function resolveTotalPages(total: number, pageSize: number): number {
  return total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
}

function normalizeText(value: string): string {
  return value.trim();
}

function partyFilter(
  currentUser: AuthenticatedUser,
  query: AliasListQuery,
): Prisma.parties_canonicalWhereInput {
  const canonicalFilter: Prisma.parties_canonicalWhereInput = {};

  if (currentUser.role === role_enum.ANALYST) {
    if (!currentUser.entityIdScope) {
      throw new HttpError("forbidden", 403, "Analyst user has no entity scope");
    }

    canonicalFilter.entity_id = currentUser.entityIdScope;
  }

  if (query.entity_code) {
    canonicalFilter.entities = { code: query.entity_code };
  }

  return canonicalFilter;
}

export function parseAliasListQuery(
  input: Record<string, string | undefined>,
): AliasListQuery {
  const parsed = aliasListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid alias query parameters.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseAliasCreateBody(input: unknown): AliasCreateBody {
  const parsed = aliasCreateSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid alias payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseAliasPatchBody(input: unknown): AliasPatchBody {
  const parsed = aliasPatchSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid alias payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listAliases(
  query: AliasListQuery,
  currentUser: AuthenticatedUser,
): Promise<AliasListResponse> {
  const prisma = getPrisma();
  const canonicalFilter = partyFilter(currentUser, query);

  const aliasWhere: Prisma.party_aliasesWhereInput = {
    ...(query.canonical_id ? { canonical_id: query.canonical_id } : {}),
    ...(query.alias_text_contains
      ? {
          alias_text: {
            contains: query.alias_text_contains,
            mode: "insensitive",
          },
        }
      : {}),
    ...(Object.keys(canonicalFilter).length > 0
      ? { parties_canonical: canonicalFilter }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.party_aliases.count({ where: aliasWhere }),
    prisma.party_aliases.findMany({
      where: aliasWhere,
      orderBy: { created_at: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        canonical_id: true,
        alias_text: true,
        source: true,
        created_by: true,
        created_at: true,
        parties_canonical: {
          select: {
            id: true,
            name: true,
            entities: { select: { code: true } },
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map(toAliasRow),
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: resolveTotalPages(total, query.page_size),
    },
  };
}

export async function createAlias(
  input: AliasCreateBody,
  currentUser: AuthenticatedUser,
): Promise<AliasRow> {
  if (
    currentUser.role === role_enum.CFO ||
    currentUser.role === role_enum.REVIEWER ||
    currentUser.role === role_enum.PENDING
  ) {
    throw new HttpError("forbidden", 403, "Insufficient permissions.");
  }

  const prisma = getPrisma();
  const canonical = await prisma.parties_canonical.findUnique({
    where: { id: input.canonical_id },
    select: { id: true, entity_id: true },
  });

  if (!canonical) {
    throw new HttpError("not_found", 404, "Canonical party not found.");
  }

  if (currentUser.role === role_enum.ANALYST) {
    await assertAnalystCanAccessEntity(currentUser, canonical.entity_id);
  }

  const aliasText = normalizeText(input.alias_text);
  const existing = await prisma.party_aliases.findFirst({
    where: {
      canonical_id: input.canonical_id,
      alias_text: aliasText,
    },
  });

  if (existing) {
    throw new HttpError(
      "ALIAS_ALREADY_EXISTS",
      409,
      "Alias already exists for this canonical party.",
    );
  }

  const row = await prisma.party_aliases.create({
    data: {
      id: createId(),
      canonical_id: input.canonical_id,
      alias_text: aliasText,
      source: "MANUAL",
      created_by: currentUser.id,
    },
    select: {
      id: true,
      canonical_id: true,
      alias_text: true,
      source: true,
      created_by: true,
      created_at: true,
      parties_canonical: {
        select: {
          id: true,
          name: true,
          entities: { select: { code: true } },
        },
      },
    },
  });

  await createAuditLog(
    currentUser.id,
    "alias.create",
    "party_aliases",
    row.id,
    {},
    {
      canonical_id: row.canonical_id,
      source: row.source,
    },
  );

  return toAliasRow(row);
}

export async function patchAlias(
  aliasId: string,
  input: AliasPatchBody,
  currentUser: AuthenticatedUser,
): Promise<AliasRow> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const alias = await getPrisma().party_aliases.findUnique({
    where: { id: aliasId },
    include: {
      parties_canonical: { select: { entity_id: true } },
    },
  });

  if (!alias) {
    throw new HttpError("not_found", 404, "Alias not found.");
  }

  const newAliasText = normalizeText(input.alias_text);
  const conflict = await getPrisma().party_aliases.findFirst({
    where: {
      canonical_id: alias.canonical_id,
      alias_text: newAliasText,
      NOT: { id: alias.id },
    },
  });
  if (conflict) {
    throw new HttpError(
      "ALIAS_ALREADY_EXISTS",
      409,
      "Alias already exists for this canonical party.",
    );
  }

  const before = { alias_text: "<redacted>" };
  const updated = await getPrisma().party_aliases.update({
    where: { id: alias.id },
    data: { alias_text: newAliasText },
    select: {
      id: true,
      canonical_id: true,
      alias_text: true,
      source: true,
      created_by: true,
      created_at: true,
      parties_canonical: {
        select: {
          id: true,
          name: true,
          entities: { select: { code: true } },
        },
      },
    },
  });

  await createAuditLog(
    currentUser.id,
    "alias.update",
    "party_aliases",
    updated.id,
    before,
    { alias_text: "<redacted>" },
  );

  return toAliasRow(updated);
}

export async function deleteAlias(
  aliasId: string,
  currentUser: AuthenticatedUser,
): Promise<void> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const existing = await prisma.party_aliases.findUnique({
    where: { id: aliasId },
    include: {
      parties_canonical: { select: { entities: { select: { code: true } } } },
    },
  });

  if (!existing) {
    throw new HttpError("not_found", 404, "Alias not found.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.party_aliases.delete({ where: { id: existing.id } });

    await createAuditLog(
      currentUser.id,
      "alias.delete",
      "party_aliases",
      existing.id,
      {
        id: existing.id,
        canonical_id: existing.canonical_id,
        source: existing.source,
        alias_text: "<redacted>",
      },
      {},
    );
  });
}
