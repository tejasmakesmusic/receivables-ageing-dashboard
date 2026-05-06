import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const userApproveSchema = z.object({
  role: z.nativeEnum(role_enum).refine((value) => value !== role_enum.PENDING, {
    message: "Cannot approve a user into PENDING.",
  }),
});

export const userListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string(),
      role: z.string(),
      entity_id_scope: z.string().uuid().nullable(),
      is_active: z.boolean(),
      created_at: z.string(),
      last_login_at: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

export const userActionResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.string(),
  is_active: z.boolean(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserListResponse = z.infer<typeof userListResponseSchema>;
export type UserActionResponse = z.infer<typeof userActionResponseSchema>;
export type UserApproveInput = z.infer<typeof userApproveSchema>;

type UserRow = Prisma.usersGetPayload<{
  select: {
    id: true;
    email: true;
    name: true;
    role: true;
    entity_id_scope: true;
    is_active: true;
    created_at: true;
    last_login_at: true;
  };
}>;

function toDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toUserRow(row: UserRow): {
  id: string;
  email: string;
  name: string;
  role: string;
  entity_id_scope: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
} {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    entity_id_scope: row.entity_id_scope,
    is_active: row.is_active,
    created_at: row.created_at.toISOString(),
    last_login_at: toDate(row.last_login_at),
  };
}

export function parseUserListQuery(
  input: Record<string, string | undefined>,
): UserListQuery {
  const parsed = userListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid users query.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseUserApproveBody(input: unknown): UserApproveInput {
  const parsed = userApproveSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid approve payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listUsers(
  query: UserListQuery,
): Promise<UserListResponse> {
  const prisma = getPrisma();

  const [total, rows] = await Promise.all([
    prisma.users.count(),
    prisma.users.findMany({
      orderBy: { created_at: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        entity_id_scope: true,
        is_active: true,
        created_at: true,
        last_login_at: true,
      },
    }),
  ]);

  return {
    items: rows.map(toUserRow),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}

export async function approveUser(
  userId: string,
  input: UserApproveInput,
  currentUser: AuthenticatedUser,
): Promise<UserActionResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      is_active: true,
    },
  });

  if (!user) {
    throw new HttpError("not_found", 404, "User not found.");
  }

  await prisma.users.update({
    where: { id: user.id },
    data: { role: input.role, is_active: true },
  });

  await createAuditLog(
    currentUser.id,
    "role_change",
    "users",
    user.id,
    { role: user.role, is_active: user.is_active },
    { role: input.role, is_active: true },
  );

  return {
    id: user.id,
    email: user.email,
    role: input.role,
    is_active: true,
  };
}

export async function deactivateUser(
  userId: string,
  currentUser: AuthenticatedUser,
): Promise<UserActionResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      is_active: true,
      entity_id_scope: true,
    },
  });

  if (!user) {
    throw new HttpError("not_found", 404, "User not found.");
  }

  if (user.id === currentUser.id) {
    throw new HttpError(
      "unprocessable_entity",
      422,
      "Cannot deactivate your own account.",
    );
  }

  if (user.is_active) {
    await prisma.users.update({
      where: { id: user.id },
      data: { is_active: false },
    });
  }

  await createAuditLog(
    currentUser.id,
    "user_deactivate",
    "users",
    user.id,
    { role: user.role, is_active: user.is_active },
    { role: user.role, is_active: false },
  );

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    is_active: false,
  };
}

export async function reactivateUser(
  userId: string,
  currentUser: AuthenticatedUser,
): Promise<UserActionResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      is_active: true,
      entity_id_scope: true,
    },
  });

  if (!user) {
    throw new HttpError("not_found", 404, "User not found.");
  }

  if (!user.is_active) {
    await prisma.users.update({
      where: { id: user.id },
      data: { is_active: true },
    });
  }

  await createAuditLog(
    currentUser.id,
    "user_reactivate",
    "users",
    user.id,
    { role: user.role, is_active: user.is_active },
    { role: user.role, is_active: true },
  );

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    is_active: true,
  };
}
