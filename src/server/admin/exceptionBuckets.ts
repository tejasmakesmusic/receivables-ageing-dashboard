import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

export const exceptionBucketListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      active: z.boolean(),
      created_at: z.string(),
    }),
  ),
  total: z.number(),
});

const exceptionBucketCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
});

const exceptionBucketPatchSchema = z
  .object({
    active: z.boolean().optional(),
    name: z.string().trim().optional(),
    description: z.string().trim().nullable().optional(),
  })
  .refine(
    (value) =>
      value.active !== undefined ||
      value.name !== undefined ||
      value.description !== undefined,
    { message: "At least one field must be provided." },
  );

export const exceptionBucketResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
});

type ExceptionBucketRow = z.infer<typeof exceptionBucketResponseSchema>;

export type ExceptionBucketCreateBody = z.infer<
  typeof exceptionBucketCreateSchema
>;
export type ExceptionBucketPatchBody = z.infer<
  typeof exceptionBucketPatchSchema
>;
export type ExceptionBucketListResponse = z.infer<
  typeof exceptionBucketListResponseSchema
>;

type BucketPayload = Prisma.exception_bucket_typesGetPayload<{
  select: {
    id: true;
    code: true;
    name: true;
    description: true;
    active: true;
    created_at: true;
  };
}>;

function toBucketRow(row: BucketPayload): ExceptionBucketRow {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    active: row.active,
    created_at: row.created_at.toISOString(),
  };
}

export function parseExceptionBucketCreateBody(
  input: unknown,
): ExceptionBucketCreateBody {
  const parsed = exceptionBucketCreateSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid exception bucket payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseExceptionBucketPatchBody(
  input: unknown,
): ExceptionBucketPatchBody {
  const parsed = exceptionBucketPatchSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid exception bucket payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listExceptionBuckets(
  currentUser: AuthenticatedUser,
): Promise<ExceptionBucketListResponse> {
  if (currentUser.role === role_enum.PENDING) {
    throw new HttpError("forbidden", 403, "Insufficient permissions.");
  }

  const rows = await getPrisma().exception_bucket_types.findMany({
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      active: true,
      created_at: true,
    },
  });

  return {
    items: rows.map(toBucketRow),
    total: rows.length,
  };
}

export async function createExceptionBucket(
  input: ExceptionBucketCreateBody,
  currentUser: AuthenticatedUser,
): Promise<ExceptionBucketRow> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const existing = await prisma.exception_bucket_types.findUnique({
    where: { code: input.code },
    select: { id: true },
  });

  if (existing) {
    throw new HttpError(
      "BUCKET_CODE_DUPLICATE",
      409,
      `Exception bucket type with code '${input.code}' already exists.`,
    );
  }

  const row = await prisma.exception_bucket_types.create({
    data: {
      id: createId(),
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      active: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      active: true,
      created_at: true,
    },
  });

  await createAuditLog(
    currentUser.id,
    "exception_bucket.create",
    "exception_bucket_types",
    row.id,
    {},
    {
      code: row.code,
      name: row.name,
      active: row.active,
    },
  );

  return toBucketRow(row);
}

export async function patchExceptionBucket(
  bucketId: string,
  input: ExceptionBucketPatchBody,
  currentUser: AuthenticatedUser,
): Promise<ExceptionBucketRow> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const existing = await prisma.exception_bucket_types.findUnique({
    where: { id: bucketId },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      active: true,
      created_at: true,
    },
  });

  if (!existing) {
    throw new HttpError("not_found", 404, "Exception bucket not found.");
  }

  const updated = await prisma.exception_bucket_types.update({
    where: { id: existing.id },
    data: {
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      active: true,
      created_at: true,
    },
  });

  await createAuditLog(
    currentUser.id,
    "exception_bucket.update",
    "exception_bucket_types",
    existing.id,
    {
      name: existing.name,
      description: existing.description,
      active: existing.active,
    },
    {
      name: updated.name,
      description: updated.description,
      active: updated.active,
    },
  );

  return toBucketRow(updated);
}
