import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

export const auditLogQuerySchema = z.object({
  actor_id: z.string().uuid().optional(),
  action: z.string().optional(),
  entity_type: z.string().optional(),
  ts_from: z.string().optional(),
  ts_to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditLogResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      actor_user_id: z.string().uuid().nullable(),
      actor_email: z.string().email().nullable(),
      action: z.string(),
      entity_type: z.string(),
      entity_id: z.string().uuid().nullable(),
      before: z.unknown(),
      after: z.unknown(),
      created_at: z.string(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

export const auditLogRowSchema = z.object({
  id: z.string().uuid(),
  actor_user_id: z.string().uuid().nullable(),
  actor_email: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  created_at: z.string(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

type AuditLogPayload = Prisma.audit_logGetPayload<{
  include: {
    users: {
      select: {
        email: true;
      };
    };
  };
}>;

function toDate(value: Date): string {
  return value.toISOString();
}

function parseDateStrict(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(
      "validation_error",
      422,
      `Invalid ${field}. Must be ISO date-time string.`,
    );
  }

  return parsed;
}

export function parseAuditLogQuery(
  input: Record<string, string | undefined>,
): AuditLogQuery {
  const parsed = auditLogQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid audit log query.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listAuditLog(
  query: AuditLogQuery,
  currentUser: AuthenticatedUser,
): Promise<AuditLogResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const where: Prisma.audit_logWhereInput = {
    ...(query.actor_id ? { actor_user_id: query.actor_id } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.entity_type ? { entity_type: query.entity_type } : {}),
    ...(query.ts_from
      ? { created_at: { gte: parseDateStrict(query.ts_from, "ts_from") } }
      : {}),
    ...(query.ts_to
      ? { created_at: { lte: parseDateStrict(query.ts_to, "ts_to") } }
      : {}),
  };

  const prisma = getPrisma();
  const [total, rows] = await Promise.all([
    prisma.audit_log.count({ where }),
    prisma.audit_log.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      include: {
        users: { select: { email: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row: AuditLogPayload) => ({
      id: row.id,
      actor_user_id: row.actor_user_id,
      actor_email: row.users?.email ?? null,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      before: row.before,
      after: row.after,
      created_at: toDate(row.created_at),
    })),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}
