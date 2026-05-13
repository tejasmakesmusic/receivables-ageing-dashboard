import { beforeEach, describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";

const prismaMock = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: prismaMock.getPrisma,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret-at-least-16-chars",
  },
}));

import { getOrCreateGoogleUser } from "@/server/core/auth";

const BASE_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "alice@emb.global",
  name: "Alice",
  role: role_enum.ANALYST,
  entity_id_scope: null,
  is_active: true,
  last_login_at: null,
  google_sub: null,
};

function makeDb(overrides: Partial<{
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    users: {
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
      update: overrides.update ?? vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...BASE_USER, ...data })
      ),
      create: overrides.create ?? vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...BASE_USER, ...data, id: "new-uuid" })
      ),
    },
  };
}

describe("getOrCreateGoogleUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns existing user matched by google_sub without creating", async () => {
    const existingUser = { ...BASE_USER, google_sub: "g-sub-1" };
    const db = makeDb({
      findUnique: vi.fn().mockResolvedValueOnce(existingUser),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: "g-sub-1",
      email: "alice@emb.global",
      name: "Alice",
    });

    expect(isNew).toBe(false);
    expect(user.id).toBe(BASE_USER.id);
    expect(db.users.create).not.toHaveBeenCalled();
  });

  it("falls back to email match and stamps google_sub when sub lookup misses", async () => {
    const existingUser = { ...BASE_USER, google_sub: null };
    const db = makeDb({
      findUnique: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingUser),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: "g-sub-new",
      email: "alice@emb.global",
      name: "Alice",
    });

    expect(isNew).toBe(false);
    expect(db.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BASE_USER.id },
        data: expect.objectContaining({ google_sub: "g-sub-new" }),
      })
    );
  });

  it("creates new PENDING user when both lookups miss", async () => {
    const db = makeDb({
      findUnique: vi.fn().mockResolvedValue(null),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: "g-sub-brand-new",
      email: "newperson@emb.global",
      name: "New Person",
    });

    expect(isNew).toBe(true);
    expect(db.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "newperson@emb.global",
          google_sub: "g-sub-brand-new",
          role: role_enum.PENDING,
          is_active: true,
        }),
      })
    );
  });

  it("updates last_login_at for existing user", async () => {
    const existingUser = { ...BASE_USER, google_sub: "g-sub-1" };
    const db = makeDb({
      findUnique: vi.fn().mockResolvedValueOnce(existingUser),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    await getOrCreateGoogleUser({
      googleSub: "g-sub-1",
      email: "alice@emb.global",
      name: "Alice",
    });

    expect(db.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ last_login_at: expect.any(Date) }),
      })
    );
  });
});
