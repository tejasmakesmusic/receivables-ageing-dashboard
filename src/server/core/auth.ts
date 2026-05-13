import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { signPayload, verifyPayload, type SignedPayload } from "@/lib/crypto";
import { getPrisma } from "@/lib/prisma";
import { ForbiddenError, UnauthorizedError } from "@/server/core/errors";

export const SESSION_COOKIE_NAME = "next_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
export const STUB_ADMIN_EMAIL = "tejaswa.sharma@emb.global";
export const STUB_GOOGLE_SUB = "stub-admin";

export type Role = (typeof role_enum)[keyof typeof role_enum];
const roleDefaults: Role[] = Object.values(role_enum);

export const isStubProviderEnabled = (): boolean =>
  env.NODE_ENV !== "production" ||
  env.AUTH_PROVIDER === "stub" ||
  env.AUTH_PROVIDER === "development";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  entityIdScope: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
};

type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: Role;
  entity_id_scope: string | null;
  is_active: boolean;
  last_login_at: Date | null;
};

type MeUserResponse = {
  id: string;
  email: string;
  name: string;
  role: Role;
  entityIdScope: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
};

function sessionPayload(userId: string): SignedPayload {
  return {
    userId,
    issuedAtEpochMs: Date.now(),
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: SESSION_TTL_SECONDS,
  };
}

function hasValidRole(role: Role): role is Role {
  return roleDefaults.includes(role);
}

export function setAuthSessionCookie(response: NextResponse, userId: string) {
  const token = signPayload(sessionPayload(userId), env.SESSION_SECRET);

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...sessionCookieOptions(),
  });
}

export function clearAuthSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    ...sessionCookieOptions(),
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<AuthenticatedUser> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!cookie) {
    throw new UnauthorizedError("Missing authentication cookie");
  }

  const payload = verifyPayload(cookie, env.SESSION_SECRET);

  if (!payload) {
    throw new UnauthorizedError("Invalid authentication cookie");
  }

  if (Date.now() - payload.issuedAtEpochMs > SESSION_TTL_MS) {
    throw new UnauthorizedError("Authentication session expired");
  }

  const user = await getPrisma().users.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      entity_id_scope: true,
      is_active: true,
      last_login_at: true,
    },
  });

  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }

  if (!user.is_active) {
    throw new UnauthorizedError("User account is inactive");
  }

  if (!hasValidRole(user.role)) {
    throw new ForbiddenError("Invalid user role");
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    entityIdScope: user.entity_id_scope,
    isActive: user.is_active,
    lastLoginAt: user.last_login_at,
  };
}

export async function requireRole(
  ...roles: Role[]
): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();

  if (!roles.includes(user.role)) {
    throw new ForbiddenError("User does not have required role");
  }

  return user;
}

export async function ensureStubAdminUser(): Promise<UserRecord> {
  if (!isStubProviderEnabled()) {
    throw new ForbiddenError(
      "Stub authentication is disabled. Use Google provider.",
    );
  }

  const prisma = getPrisma();
  const existing = await prisma.users.findUnique({
    where: { email: STUB_ADMIN_EMAIL },
  });

  if (existing) {
    const updated = await prisma.users.update({
      where: { id: existing.id },
      data: {
        name: existing.name || "Tejaswa Sharma",
        role: role_enum.ADMIN,
        google_sub: existing.google_sub || STUB_GOOGLE_SUB,
        is_active: true,
        last_login_at: new Date(),
      },
    });

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      entity_id_scope: updated.entity_id_scope,
      is_active: updated.is_active,
      last_login_at: updated.last_login_at,
    };
  }

  const created = await prisma.users.create({
    data: {
      id: createId(),
      email: STUB_ADMIN_EMAIL,
      name: "Tejaswa Sharma",
      google_sub: STUB_GOOGLE_SUB,
      role: role_enum.ADMIN,
      is_active: true,
      last_login_at: new Date(),
    },
  });

  return {
    id: created.id,
    email: created.email,
    name: created.name,
    role: created.role,
    entity_id_scope: created.entity_id_scope,
    is_active: created.is_active,
    last_login_at: created.last_login_at,
  };
}

export function asAuthenticatedUserResponse(
  user: AuthenticatedUser,
): MeUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    entityIdScope: user.entityIdScope,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function getOrCreateGoogleUser({
  googleSub,
  email,
  name,
}: {
  googleSub: string;
  email: string;
  name: string;
}): Promise<{ user: UserRecord; isNew: boolean }> {
  const prisma = getPrisma();
  const now = new Date();

  // 1. Match by google_sub (returning user on any device)
  const byGoogleSub = await prisma.users.findUnique({
    where: { google_sub: googleSub },
  });

  if (byGoogleSub) {
    const updated = await prisma.users.update({
      where: { id: byGoogleSub.id },
      data: { last_login_at: now },
    });
    return { user: updated as UserRecord, isNew: false };
  }

  // 2. Match by email (handles stub-created accounts or prior signups)
  const byEmail = await prisma.users.findUnique({
    where: { email },
  });

  if (byEmail) {
    const updated = await prisma.users.update({
      where: { id: byEmail.id },
      data: { google_sub: googleSub, last_login_at: now },
    });
    return { user: updated as UserRecord, isNew: false };
  }

  // 3. Brand new user — create with PENDING role
  const newUser = await prisma.users.create({
    data: {
      id: createId(),
      email,
      name,
      google_sub: googleSub,
      role: role_enum.PENDING,
      is_active: true,
      last_login_at: now,
    },
  });

  return { user: newUser as UserRecord, isNew: true };
}
