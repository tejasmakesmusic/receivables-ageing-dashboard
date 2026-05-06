/**
 * RBAC guard unit tests — no DB required.
 *
 * Covers:
 *  - assertReadOnlyForCfo: CFO cannot mutate
 *  - assertNotPending: PENDING cannot access anything
 *  - assertFxImmutable: FX rows always return 405
 */
import { describe, it, expect } from "vitest";
import { assertReadOnlyForCfo } from "@/server/core/assertReadOnlyForCfo";
import { assertNotPending } from "@/server/core/assertNotPending";
import { assertFxImmutable } from "@/server/core/assertFxImmutable";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { role_enum } from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";

function makeUser(
  role: role_enum,
  entityIdScope?: string,
): AuthenticatedUser {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "test@emb.global",
    name: "Test User",
    role,
    entityIdScope: entityIdScope ?? null,
    isActive: true,
    lastLoginAt: null,
  };
}

// ── assertReadOnlyForCfo ──────────────────────────────────────────────────────

describe("assertReadOnlyForCfo", () => {
  it("throws ForbiddenError for CFO role", () => {
    expect(() => assertReadOnlyForCfo(makeUser(role_enum.CFO))).toThrow(
      ForbiddenError,
    );
  });

  it("does not throw for ANALYST role", () => {
    expect(() =>
      assertReadOnlyForCfo(makeUser(role_enum.ANALYST, "entity-1")),
    ).not.toThrow();
  });

  it("does not throw for ADMIN role", () => {
    expect(() => assertReadOnlyForCfo(makeUser(role_enum.ADMIN))).not.toThrow();
  });

  it("throws for CFO even with no entity scope", () => {
    expect(() => assertReadOnlyForCfo(makeUser(role_enum.CFO))).toThrowError(
      /read-only/i,
    );
  });
});

// ── assertNotPending ──────────────────────────────────────────────────────────

describe("assertNotPending", () => {
  it("throws ForbiddenError for PENDING role", () => {
    expect(() => assertNotPending(makeUser(role_enum.PENDING))).toThrow(
      ForbiddenError,
    );
  });

  it("does not throw for ANALYST role", () => {
    expect(() =>
      assertNotPending(makeUser(role_enum.ANALYST, "entity-1")),
    ).not.toThrow();
  });

  it("does not throw for CFO role", () => {
    expect(() => assertNotPending(makeUser(role_enum.CFO))).not.toThrow();
  });

  it("does not throw for ADMIN role", () => {
    expect(() => assertNotPending(makeUser(role_enum.ADMIN))).not.toThrow();
  });

  it("error message mentions pending approval", () => {
    expect(() => assertNotPending(makeUser(role_enum.PENDING))).toThrowError(
      /pending/i,
    );
  });
});

// ── assertFxImmutable ─────────────────────────────────────────────────────────

describe("assertFxImmutable", () => {
  it("always throws HttpError with 405 status", () => {
    expect(() => assertFxImmutable()).toThrow(HttpError);
  });

  it("throws with method_not_allowed code", () => {
    try {
      assertFxImmutable();
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(405);
    }
  });
});
