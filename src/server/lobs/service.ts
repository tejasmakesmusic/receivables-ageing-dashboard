import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";

/**
 * PR 9 — LOB (Line of Business) CRUD. Per-entity tags applied to invoices.
 *
 *   Auto-tag: at publish time, if the invoice's source-side project_id
 *   matches an active LOB code (case-insensitive) for the entity, the
 *   invoice's lob_id is stamped automatically. Manual override later.
 *
 *   RBAC: ADMIN may create/edit/deactivate. ANALYSTs may read LOBs for
 *   their own entity (so they can filter on the invoice list). CFO and
 *   REVIEWER read-only across all entities.
 */
export const createLobSchema = z.object({
  entity_code: z.enum(["IND", "UAE"]),
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, _ and -"),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2000).optional(),
});
export type CreateLobInput = z.infer<typeof createLobSchema>;

export const updateLobSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});
export type UpdateLobInput = z.infer<typeof updateLobSchema>;

export interface LobRow {
  id: string;
  entity_id: string;
  entity_code: "IND" | "UAE";
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  invoice_count: number;
  created_by_email: string | null;
  created_at: string;
  updated_by_email: string | null;
  updated_at: string;
}

function assertCanWrite(currentUser: AuthenticatedUser): void {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new ForbiddenError("Only ADMIN may manage LOBs");
  }
}

export async function listLobs(
  filters: { entity_code?: "IND" | "UAE"; active?: boolean },
  currentUser: AuthenticatedUser,
): Promise<LobRow[]> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};
  if (filters.entity_code) {
    where.entities = { is: { code: filters.entity_code } };
  }
  if (currentUser.role === role_enum.ANALYST && currentUser.entityIdScope) {
    where.entity_id = currentUser.entityIdScope;
  }
  if (filters.active !== undefined) {
    where.active = filters.active;
  }
  const rows = await prisma.lobs.findMany({
    where,
    orderBy: [{ entity_id: "asc" }, { code: "asc" }],
    include: {
      entities: { select: { code: true } },
      users_lobs_created_byTousers: { select: { email: true } },
      users_lobs_updated_byTousers: { select: { email: true } },
      _count: { select: { invoices: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    entity_id: r.entity_id,
    entity_code: r.entities.code as "IND" | "UAE",
    code: r.code,
    name: r.name,
    description: r.description,
    active: r.active,
    invoice_count: r._count.invoices,
    created_by_email: r.users_lobs_created_byTousers?.email ?? null,
    created_at: r.created_at.toISOString(),
    updated_by_email: r.users_lobs_updated_byTousers?.email ?? null,
    updated_at: r.updated_at.toISOString(),
  }));
}

export async function createLob(
  body: CreateLobInput,
  currentUser: AuthenticatedUser,
): Promise<LobRow> {
  assertCanWrite(currentUser);
  const prisma = getPrisma();
  const entity = await prisma.entities.findUnique({
    where: { code: body.entity_code },
    select: { id: true },
  });
  if (!entity) throw new HttpError("not_found", 404, "Entity not found");

  const existing = await prisma.lobs.findUnique({
    where: {
      entity_id_code: { entity_id: entity.id, code: body.code },
    },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(
      "lob_code_conflict",
      409,
      `LOB code ${body.code} already exists for ${body.entity_code}`,
    );
  }

  const now = new Date();
  const id = createId();
  await prisma.$transaction(async (tx) => {
    await tx.lobs.create({
      data: {
        id,
        entity_id: entity.id,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        created_by: currentUser.id,
        created_at: now,
        updated_at: now,
      },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "lob.create",
        entity_type: "lobs",
        entity_id: id,
        after: {
          entity_code: body.entity_code,
          code: body.code,
          name: body.name,
        },
      },
    });
  });

  const [created] = await listLobs(
    { entity_code: body.entity_code },
    currentUser,
  );
  // listLobs is sorted by code; refetch the specific row.
  const row = await prisma.lobs.findUnique({ where: { id } });
  if (!row || !created) {
    throw new HttpError("internal_server_error", 500, "Failed to load LOB");
  }
  return (
    (await listLobs({ entity_code: body.entity_code }, currentUser)).find(
      (r) => r.id === id,
    ) ?? created
  );
}

export async function updateLob(
  lobId: string,
  body: UpdateLobInput,
  currentUser: AuthenticatedUser,
): Promise<LobRow> {
  assertCanWrite(currentUser);
  const prisma = getPrisma();
  const existing = await prisma.lobs.findUnique({
    where: { id: lobId },
    include: { entities: { select: { code: true } } },
  });
  if (!existing) throw new HttpError("not_found", 404, "LOB not found");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.lobs.update({
      where: { id: lobId },
      data: {
        name: body.name ?? existing.name,
        description:
          body.description === undefined
            ? existing.description
            : body.description,
        active: body.active ?? existing.active,
        updated_by: currentUser.id,
        updated_at: now,
      },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "lob.update",
        entity_type: "lobs",
        entity_id: lobId,
        before: {
          name: existing.name,
          description: existing.description,
          active: existing.active,
        },
        after: body,
      },
    });
  });

  return (
    (
      await listLobs(
        { entity_code: existing.entities.code as "IND" | "UAE" },
        currentUser,
      )
    ).find((r) => r.id === lobId) ?? {
      id: lobId,
      entity_id: existing.entity_id,
      entity_code: existing.entities.code as "IND" | "UAE",
      code: existing.code,
      name: body.name ?? existing.name,
      description:
        body.description === undefined
          ? existing.description
          : (body.description ?? null),
      active: body.active ?? existing.active,
      invoice_count: 0,
      created_by_email: null,
      created_at: existing.created_at.toISOString(),
      updated_by_email: null,
      updated_at: now.toISOString(),
    }
  );
}

/**
 * Match a project_id-like string (from Xero metadata) against the entity's
 * active LOBs by case-insensitive code match. Used at publish time.
 */
export async function findActiveLobByCode(
  entityId: string,
  code: string | null | undefined,
): Promise<{ id: string } | null> {
  if (!code) return null;
  const prisma = getPrisma();
  // Postgres ILIKE for case-insensitive exact match, plus active filter.
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id::text AS id FROM lobs
     WHERE entity_id = $1::uuid AND active = TRUE
       AND lower(code) = lower($2)
     LIMIT 1`,
    entityId,
    code.trim(),
  );
  return rows[0] ?? null;
}
