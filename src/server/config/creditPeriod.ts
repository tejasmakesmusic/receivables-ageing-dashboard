import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { dbTransaction } from "@/lib/db-transaction";
import { createId } from "@/lib/ids";
import type { AuthenticatedUser } from "@/server/core/auth";
import { z } from "zod";

export const creditPeriodListQuerySchema = z.object({
  entity_code: z.enum(["IND", "UAE"]).optional(),
  include_closed: z.coerce.boolean().optional().default(false),
  party_name_contains: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const creditPeriodCreateSchema = z.object({
  canonical_id: z.string().uuid("canonical_id must be a valid UUID"),
  credit_days: z.number().int().min(0, "credit_days must be >= 0"),
  reason_note: z
    .string()
    .trim()
    .transform((value) => value || null)
    .optional()
    .nullable(),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "valid_from must be YYYY-MM-DD"),
});

const creditPeriodPatchSchema = z
  .object({
    credit_days: z.number().int().min(0).optional(),
    reason_note: z
      .string()
      .trim()
      .transform((value) => value)
      .optional(),
  })
  .refine(
    (value) =>
      value.credit_days !== undefined || value.reason_note !== undefined,
    { message: "At least one field must be provided." },
  );

export const creditPeriodListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      canonical_id: z.string().uuid(),
      canonical_name: z.string(),
      entity_code: z.enum(["IND", "UAE"]),
      credit_days: z.number().int(),
      reason_note: z.string().nullable(),
      valid_from: z.string(),
      valid_to: z.string().nullable(),
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

export const creditPeriodCreateResponseSchema = z.object({
  id: z.string().uuid(),
  canonical_id: z.string().uuid(),
  canonical_name: z.string(),
  entity_code: z.enum(["IND", "UAE"]),
  credit_days: z.number().int(),
  reason_note: z.string().nullable(),
  valid_from: z.string(),
  valid_to: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});

export type CreditPeriodListQuery = z.infer<typeof creditPeriodListQuerySchema>;
export type CreditPeriodCreateBody = z.infer<typeof creditPeriodCreateSchema>;
export type CreditPeriodPatchBody = z.infer<typeof creditPeriodPatchSchema>;
export type CreditPeriodListResponse = z.infer<
  typeof creditPeriodListResponseSchema
>;
export type CreditPeriodRow = z.infer<typeof creditPeriodCreateResponseSchema>;

type CreditPeriodRowPayload = Prisma.credit_period_configGetPayload<{
  select: {
    id: true;
    canonical_id: true;
    days: true;
    reason_note: true;
    valid_from: true;
    valid_to: true;
    updated_by: true;
    updated_at: true;
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

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError("validation_error", 400, "Invalid date format.");
  }

  return parsed;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDateTime(value: Date): string {
  return value.toISOString();
}

function normalizeReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function resolveTotalPages(total: number, pageSize: number): number {
  return total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
}

function toCreditPeriodRow(row: CreditPeriodRowPayload): CreditPeriodRow {
  return {
    id: row.id,
    canonical_id: row.canonical_id,
    canonical_name: row.parties_canonical.name,
    entity_code: row.parties_canonical.entities.code as "IND" | "UAE",
    credit_days: row.days,
    reason_note: row.reason_note,
    valid_from: toDateOnly(row.valid_from),
    valid_to: row.valid_to ? toDateOnly(row.valid_to) : null,
    created_by: row.updated_by,
    created_at: toDateTime(row.updated_at),
  };
}

function buildPartyFilter(
  currentUser: AuthenticatedUser,
  query: CreditPeriodListQuery,
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

  if (query.party_name_contains) {
    canonicalFilter.name = {
      contains: query.party_name_contains,
      mode: "insensitive",
    };
  }

  return canonicalFilter;
}

export function parseCreditPeriodListQuery(
  input: Record<string, string | undefined>,
): CreditPeriodListQuery {
  const parsed = creditPeriodListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ??
      "Invalid credit period query parameters.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseCreditPeriodCreateBody(
  input: unknown,
): CreditPeriodCreateBody {
  const parsed = creditPeriodCreateSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid credit period payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseCreditPeriodPatchBody(
  input: unknown,
): CreditPeriodPatchBody {
  const parsed = creditPeriodPatchSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid credit period patch payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listCreditPeriods(
  query: CreditPeriodListQuery,
  currentUser: AuthenticatedUser,
): Promise<CreditPeriodListResponse> {
  const prisma = getPrisma();
  const canonicalFilter = buildPartyFilter(currentUser, query);

  const where: Prisma.credit_period_configWhereInput = {
    ...(query.include_closed ? {} : { valid_to: null }),
    ...(Object.keys(canonicalFilter).length > 0
      ? { parties_canonical: canonicalFilter }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.credit_period_config.count({ where }),
    prisma.credit_period_config.findMany({
      where,
      orderBy: { valid_from: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        canonical_id: true,
        days: true,
        reason_note: true,
        valid_from: true,
        valid_to: true,
        updated_by: true,
        updated_at: true,
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
    items: rows.map(toCreditPeriodRow),
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: resolveTotalPages(total, query.page_size),
    },
  };
}

export async function createCreditPeriod(
  input: CreditPeriodCreateBody,
  currentUser: AuthenticatedUser,
): Promise<CreditPeriodRow> {
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

  const validFrom = parseDateOnly(input.valid_from);
  const priorValidTo = new Date(validFrom);
  priorValidTo.setUTCDate(priorValidTo.getUTCDate() - 1);
  const normalizedReason = normalizeReason(input.reason_note);

  // Pre-fetch the prior open config before the transaction so we can build
  // the audit log `before` snapshot outside the callback. The race-condition
  // guard (close old row) still happens inside the transaction; we only use
  // this read for audit metadata.
  const priorForAudit = await prisma.credit_period_config.findFirst({
    where: { canonical_id: canonical.id, valid_to: null },
    orderBy: { valid_from: "desc" },
    select: {
      id: true,
      canonical_id: true,
      days: true,
      valid_from: true,
      valid_to: true,
    },
  });

  const before: Record<string, unknown> = {};
  if (priorForAudit) {
    before.valid_to = priorForAudit.valid_to
      ? toDateOnly(priorForAudit.valid_to)
      : null;
    before.valid_from = toDateOnly(priorForAudit.valid_from);
    before.credit_days = priorForAudit.days;
    before.canonical_id = priorForAudit.canonical_id;
  }

  // Transaction: close prior open row (if any) and insert the new one.
  // maxWait/timeout: simple (≤2 writes) → standard short-lived timeout.
  const created = await dbTransaction(
    "credit_period_config.create",
    async (tx) => {
      const prior = await tx.credit_period_config.findFirst({
        where: { canonical_id: canonical.id, valid_to: null },
        orderBy: { valid_from: "desc" },
        select: { id: true },
      });

      if (prior) {
        await tx.credit_period_config.update({
          where: { id: prior.id },
          data: { valid_to: priorValidTo },
        });
      }

      return tx.credit_period_config.create({
        data: {
          id: createId(),
          canonical_id: canonical.id,
          days: input.credit_days,
          reason_note: normalizedReason,
          valid_from: validFrom,
          valid_to: null,
          updated_by: currentUser.id,
        },
        select: {
          id: true,
          canonical_id: true,
          days: true,
          reason_note: true,
          valid_from: true,
          valid_to: true,
          updated_by: true,
          updated_at: true,
          parties_canonical: {
            select: {
              id: true,
              name: true,
              entities: { select: { code: true } },
            },
          },
        },
      });
    },
    { maxWait: 2_000, timeout: 10_000 },
  );

  // Audit log written outside the transaction — no tx handle needed.
  await createAuditLog(
    currentUser.id,
    "credit_period_config.create",
    "credit_period_config",
    created.id,
    before,
    {
      canonical_id: created.canonical_id,
      credit_days: created.days,
      valid_from: toDateOnly(created.valid_from),
    },
  );

  return toCreditPeriodRow(created);
}

export interface PartyCreditPeriodSummary {
  canonical_id: string;
  canonical_name: string;
  entity_code: "IND" | "UAE";
  entity_default_credit_days: number | null;
  credit_days: number | null;
  source: "party" | "entity_default" | "none";
  valid_from: string | null;
  reason_note: string | null;
  updated_at: string | null;
}

export async function listPartiesWithCreditPeriodSummary(
  currentUser: AuthenticatedUser,
): Promise<PartyCreditPeriodSummary[]> {
  const prisma = getPrisma();
  const where: Prisma.parties_canonicalWhereInput =
    currentUser.role === role_enum.ANALYST && currentUser.entityIdScope
      ? { entity_id: currentUser.entityIdScope }
      : {};

  const parties = await prisma.parties_canonical.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      entities: {
        select: { code: true, default_credit_days: true },
      },
    },
  });

  const openConfigs = await prisma.credit_period_config.findMany({
    where: {
      valid_to: null,
      canonical_id: { in: parties.map((p) => p.id) },
    },
    select: {
      canonical_id: true,
      days: true,
      valid_from: true,
      reason_note: true,
      updated_at: true,
    },
  });

  const openByParty = new Map(
    openConfigs.map((c) => [c.canonical_id, c]),
  );

  return parties.map((p) => {
    const open = openByParty.get(p.id) ?? null;
    const entityDefault = p.entities.default_credit_days;
    const partyDays = open?.days ?? null;
    const credit_days = partyDays ?? entityDefault;
    const source: "party" | "entity_default" | "none" =
      partyDays !== null
        ? "party"
        : entityDefault !== null
          ? "entity_default"
          : "none";

    return {
      canonical_id: p.id,
      canonical_name: p.name,
      entity_code: p.entities.code as "IND" | "UAE",
      entity_default_credit_days: entityDefault,
      credit_days,
      source,
      valid_from: open?.valid_from ? toDateOnly(open.valid_from) : null,
      reason_note: open?.reason_note ?? null,
      updated_at: open?.updated_at ? toDateTime(open.updated_at) : null,
    };
  });
}

const creditPeriodBulkSchema = z.object({
  canonical_ids: z
    .array(z.string().uuid())
    .min(1, "At least one party required")
    .max(500, "Too many parties in one batch (max 500)"),
  credit_days: z.number().int().min(0),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason_note: z
    .string()
    .trim()
    .transform((v) => v || null)
    .optional()
    .nullable(),
});

export type CreditPeriodBulkBody = z.infer<typeof creditPeriodBulkSchema>;

export function parseCreditPeriodBulkBody(input: unknown): CreditPeriodBulkBody {
  const parsed = creditPeriodBulkSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(
      "validation_error",
      400,
      parsed.error.issues[0]?.message ?? "Invalid bulk payload.",
    );
  }
  return parsed.data;
}

export interface CreditPeriodBulkResult {
  applied: number;
  failed: { canonical_id: string; message: string }[];
}

export async function bulkCreateCreditPeriod(
  input: CreditPeriodBulkBody,
  currentUser: AuthenticatedUser,
): Promise<CreditPeriodBulkResult> {
  if (
    currentUser.role !== role_enum.ANALYST &&
    currentUser.role !== role_enum.ADMIN
  ) {
    throw new HttpError("forbidden", 403, "Insufficient permissions.");
  }

  // Audit 2026-05-16: prior implementation called createCreditPeriod
  // sequentially. With 500 ids × ~50ms Neon RTT that exceeded the request
  // timeout. Each createCreditPeriod call still runs in its own transaction
  // (atomic per-party — partial batch failures don't corrupt that row);
  // we now bound concurrency to BATCH_SIZE so we get parallelism without
  // exhausting the Neon connection pool.
  const BATCH_SIZE = 25;
  let applied = 0;
  const failed: { canonical_id: string; message: string }[] = [];

  for (let i = 0; i < input.canonical_ids.length; i += BATCH_SIZE) {
    const batch = input.canonical_ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((canonicalId) =>
        createCreditPeriod(
          {
            canonical_id: canonicalId,
            credit_days: input.credit_days,
            valid_from: input.valid_from,
            reason_note: input.reason_note ?? null,
          },
          currentUser,
        ).then(() => canonicalId),
      ),
    );
    for (let j = 0; j < results.length; j += 1) {
      const result = results[j];
      const canonicalId = batch[j];
      if (result.status === "fulfilled") {
        applied += 1;
      } else {
        const reason = result.reason;
        failed.push({
          canonical_id: canonicalId,
          message: reason instanceof Error ? reason.message : "Failed",
        });
      }
    }
  }

  return { applied, failed };
}

export async function patchCreditPeriod(
  configId: string,
  input: CreditPeriodPatchBody,
  currentUser: AuthenticatedUser,
): Promise<CreditPeriodRow> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const row = await getPrisma().credit_period_config.findUnique({
    where: { id: configId },
    select: {
      id: true,
      canonical_id: true,
      days: true,
      reason_note: true,
      valid_from: true,
      valid_to: true,
      updated_by: true,
      updated_at: true,
      parties_canonical: {
        select: {
          id: true,
          name: true,
          entities: { select: { code: true } },
        },
      },
    },
  });

  if (!row) {
    throw new HttpError("not_found", 404, "Credit-period row not found.");
  }

  if (row.valid_to !== null) {
    throw new HttpError(
      "CREDIT_PERIOD_ROW_CLOSED",
      409,
      "Only the open row (valid_to is NULL) may be updated.",
    );
  }

  const before = {
    credit_days: row.days,
    reason_note: row.reason_note,
  };

  const updatedReason =
    input.reason_note === undefined
      ? row.reason_note
      : normalizeReason(input.reason_note);

  const updated = await getPrisma().credit_period_config.update({
    where: { id: row.id },
    data: {
      ...(input.credit_days === undefined ? {} : { days: input.credit_days }),
      ...(input.reason_note === undefined
        ? {}
        : { reason_note: updatedReason }),
      updated_by: currentUser.id,
    },
    select: {
      id: true,
      canonical_id: true,
      days: true,
      reason_note: true,
      valid_from: true,
      valid_to: true,
      updated_by: true,
      updated_at: true,
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
    "credit_period_config.update",
    "credit_period_config",
    updated.id,
    before,
    {
      credit_days: updated.days,
      reason_note: updated.reason_note,
    },
  );

  return toCreditPeriodRow(updated);
}
