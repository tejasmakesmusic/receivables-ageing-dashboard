import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";

const EXCEPTION_STATUSES = ["ACTIVE", "RESOLVED", "AUTO_RESOLVED"] as const;

export const exceptionCreateSchema = z.object({
  bucket_type_code: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  expected_resolution_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  note: z.string().trim().nullable().optional(),
});

export const exceptionUpdateSchema = z.object({
  action: z.enum(["RESOLVE", "UPDATE_NOTE", "UPDATE_EXPECTED_RESOLUTION_DATE"]),
  resolution_note: z.string().trim().nullable().optional(),
  note: z.string().trim().nullable().optional(),
  expected_resolution_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const exceptionListFiltersSchema = z.object({
  entity: z.enum(["IND", "UAE"]).optional(),
  status: z.enum(EXCEPTION_STATUSES).optional(),
  bucket_type: z.string().trim().min(1).optional(),
  invoice_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export type ExceptionCreateInput = z.infer<typeof exceptionCreateSchema>;
export type ExceptionUpdateInput = z.infer<typeof exceptionUpdateSchema>;
export type ExceptionListFilters = z.infer<typeof exceptionListFiltersSchema>;

export interface ExceptionListRow {
  id: string;
  invoice_id: string;
  invoice_ref: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  bucket_type_code: string;
  bucket_type_name: string;
  reason: string;
  status: string;
  tagged_at: string;
  tagged_by_email: string;
  expected_resolution_date: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface ExceptionListResponse {
  items: ExceptionListRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface ExceptionCreateResponse {
  id: string;
  invoice_id: string;
  bucket_type_code: string;
  bucket_type_name: string;
  reason: string;
  tagged_at: string;
  tagged_by_email: string;
  status: string;
  expected_resolution_date: string | null;
  note: string | null;
}

export interface ExceptionUpdateResponse {
  id: string;
  invoice_id: string;
  status: string;
  action_applied: ExceptionUpdateInput["action"];
  resolved_at: string | null;
  resolution_note: string | null;
  note: string | null;
  expected_resolution_date: string | null;
}

type ExceptionWithJoins = Prisma.exception_tagsGetPayload<{
  include: {
    exception_bucket_types: { select: { code: true; name: true } };
    invoices: {
      select: {
        id: true;
        invoice_ref: true;
        entity_id: true;
        entities: { select: { code: true } };
        parties_canonical: { select: { id: true; name: true } };
      };
    };
    users_exception_tags_tagged_byTousers: { select: { email: true } };
  };
}>;

function dateOnly(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function dateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function parseDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function requireAnalystScope(user: AuthenticatedUser): void {
  if (user.role === role_enum.ANALYST && !user.entityIdScope) {
    throw new ForbiddenError("Analyst user has no entity scope");
  }
}

function toListRow(tag: ExceptionWithJoins): ExceptionListRow {
  return {
    id: tag.id,
    invoice_id: tag.invoice_id,
    invoice_ref: tag.invoices.invoice_ref,
    canonical_id: tag.invoices.parties_canonical.id,
    canonical_name: tag.invoices.parties_canonical.name,
    entity_code: tag.invoices.entities.code,
    bucket_type_code: tag.exception_bucket_types.code,
    bucket_type_name: tag.exception_bucket_types.name,
    reason: tag.reason,
    status: tag.status,
    tagged_at: tag.tagged_at.toISOString(),
    tagged_by_email: tag.users_exception_tags_tagged_byTousers.email,
    expected_resolution_date: dateOnly(tag.expected_resolution_date),
    resolved_at: dateTime(tag.resolved_at),
    resolution_note: tag.resolution_note,
  };
}

function exceptionInclude() {
  return {
    exception_bucket_types: { select: { code: true, name: true } },
    invoices: {
      select: {
        id: true,
        invoice_ref: true,
        entity_id: true,
        entities: { select: { code: true } },
        parties_canonical: { select: { id: true, name: true } },
      },
    },
    users_exception_tags_tagged_byTousers: { select: { email: true } },
  } satisfies Prisma.exception_tagsInclude;
}

function buildWhere(
  filters: ExceptionListFilters,
  currentUser: AuthenticatedUser,
): Prisma.exception_tagsWhereInput {
  requireAnalystScope(currentUser);

  const invoiceWhere: Prisma.invoicesWhereInput = {};

  if (currentUser.role === role_enum.ANALYST && currentUser.entityIdScope) {
    invoiceWhere.entity_id = currentUser.entityIdScope;
  }

  if (filters.entity) {
    invoiceWhere.entities = { code: filters.entity };
  }

  const where: Prisma.exception_tagsWhereInput = {
    ...(Object.keys(invoiceWhere).length
      ? { invoices: { is: invoiceWhere } }
      : {}),
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.bucket_type) {
    where.exception_bucket_types = { is: { code: filters.bucket_type } };
  }

  if (filters.invoice_id) {
    where.invoice_id = filters.invoice_id;
  }

  return where;
}

export async function listExceptions(
  filters: ExceptionListFilters,
  currentUser: AuthenticatedUser,
): Promise<ExceptionListResponse> {
  const prisma = getPrisma();
  const where = buildWhere(filters, currentUser);

  const [total, rows] = await Promise.all([
    prisma.exception_tags.count({ where }),
    prisma.exception_tags.findMany({
      where,
      include: exceptionInclude(),
      orderBy: { tagged_at: "desc" },
      skip: (filters.page - 1) * filters.page_size,
      take: filters.page_size,
    }),
  ]);

  return {
    items: rows.map(toListRow),
    total,
    page: filters.page,
    page_size: filters.page_size,
  };
}

export async function createExceptionForInvoice(
  invoiceId: string,
  body: ExceptionCreateInput,
  currentUser: AuthenticatedUser,
): Promise<ExceptionCreateResponse> {
  const prisma = getPrisma();
  const invoice = await prisma.invoices.findUnique({
    where: { id: invoiceId },
    select: { id: true, entity_id: true, status: true },
  });

  if (!invoice) {
    throw new HttpError("not_found", 404, "Invoice not found");
  }

  await assertAnalystCanAccessEntity(currentUser, invoice.entity_id);

  if (invoice.status !== "OPEN") {
    throw new HttpError(
      "invoice_not_open",
      422,
      "Exception tags can only be created on OPEN invoices",
    );
  }

  const bucketType = await prisma.exception_bucket_types.findUnique({
    where: { code: body.bucket_type_code },
    select: { id: true, code: true, name: true, active: true },
  });

  if (!bucketType) {
    throw new HttpError("bucket_type_not_found", 400, "Bucket type not found");
  }

  if (!bucketType.active) {
    throw new HttpError("bucket_type_inactive", 400, "Bucket type is inactive");
  }

  const tagId = createId();
  const created = await prisma.$transaction(async (tx) => {
    const tag = await tx.exception_tags.create({
      data: {
        id: tagId,
        invoice_id: invoiceId,
        bucket_type_id: bucketType.id,
        reason: body.reason,
        tagged_by: currentUser.id,
        expected_resolution_date: parseDate(body.expected_resolution_date),
        status: "ACTIVE",
      },
      include: exceptionInclude(),
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "exception_tag.create",
        entity_type: "exception_tags",
        entity_id: tag.id,
        before: Prisma.JsonNull,
        after: {
          invoice_id: invoiceId,
          bucket_type_code: bucketType.code,
          status: "ACTIVE",
        },
      },
    });

    return tag;
  });

  return {
    id: created.id,
    invoice_id: created.invoice_id,
    bucket_type_code: created.exception_bucket_types.code,
    bucket_type_name: created.exception_bucket_types.name,
    reason: created.reason,
    tagged_at: created.tagged_at.toISOString(),
    tagged_by_email: created.users_exception_tags_tagged_byTousers.email,
    status: created.status,
    expected_resolution_date: dateOnly(created.expected_resolution_date),
    note: body.note ?? null,
  };
}

export async function updateException(
  exceptionId: string,
  body: ExceptionUpdateInput,
  currentUser: AuthenticatedUser,
): Promise<ExceptionUpdateResponse> {
  const prisma = getPrisma();
  const existing = await prisma.exception_tags.findUnique({
    where: { id: exceptionId },
    include: {
      invoices: {
        select: {
          entity_id: true,
        },
      },
    },
  });

  if (!existing) {
    throw new HttpError("not_found", 404, "Exception not found");
  }

  await assertAnalystCanAccessEntity(currentUser, existing.invoices.entity_id);

  if (body.action === "RESOLVE" && existing.status !== "ACTIVE") {
    throw new HttpError(
      "exception_already_resolved",
      409,
      "Only ACTIVE exceptions can be resolved",
    );
  }

  const updateData: Prisma.exception_tagsUncheckedUpdateInput =
    body.action === "RESOLVE"
      ? {
          status: "RESOLVED",
          resolved_at: new Date(),
          resolved_by: currentUser.id,
          resolution_note: body.resolution_note ?? null,
        }
      : body.action === "UPDATE_NOTE"
        ? { resolution_note: body.note ?? null }
        : {
            expected_resolution_date: parseDate(body.expected_resolution_date),
          };

  const before = {
    status: existing.status,
    expected_resolution_date: dateOnly(existing.expected_resolution_date),
    resolution_note: existing.resolution_note,
  };

  const updated = await prisma.$transaction(async (tx) => {
    const tag = await tx.exception_tags.update({
      where: { id: exceptionId },
      data: updateData,
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "exception_tag.update",
        entity_type: "exception_tags",
        entity_id: exceptionId,
        before,
        after: {
          action: body.action,
          status: tag.status,
          expected_resolution_date: dateOnly(tag.expected_resolution_date),
          resolution_note: tag.resolution_note,
        },
      },
    });

    return tag;
  });

  return {
    id: updated.id,
    invoice_id: updated.invoice_id,
    status: updated.status,
    action_applied: body.action,
    resolved_at: dateTime(updated.resolved_at),
    resolution_note: updated.resolution_note,
    note: body.action === "UPDATE_NOTE" ? updated.resolution_note : null,
    expected_resolution_date: dateOnly(updated.expected_resolution_date),
  };
}
