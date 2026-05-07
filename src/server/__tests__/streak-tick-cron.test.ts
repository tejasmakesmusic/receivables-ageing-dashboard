import { beforeEach, describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";
import type { NextRequest } from "next/server";

const serviceMock = vi.hoisted(() => ({
  tickStreaks: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock("@/server/engagement/streaks", () => ({
  tickStreaks: serviceMock.tickStreaks,
}));

vi.mock("@/server/core/auth", () => ({
  requireRole: authMock.requireRole,
}));

describe("POST /api/cron/streak-tick", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret";
    process.env.CRON_ACTOR_USER_ID = "22222222-2222-2222-2222-222222222222";
    serviceMock.tickStreaks.mockResolvedValue({
      evaluated: 2,
      credited: 1,
      frozen: 1,
      reset: 0,
    });
    authMock.requireRole.mockResolvedValue({
      id: "admin-id",
      email: "admin@emb.global",
      name: "Admin",
      role: role_enum.ADMIN,
      entityIdScope: null,
      isActive: true,
      lastLoginAt: null,
    });
  });

  it("requires CRON_SECRET or an admin session", async () => {
    delete process.env.CRON_SECRET;
    authMock.requireRole.mockRejectedValue(new Error("missing session"));
    const { POST } = await import("@/app/api/cron/streak-tick/route");

    const response = await POST(
      new Request("http://localhost/api/cron/streak-tick", {
        method: "POST",
      }) as NextRequest,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "unauthorized",
      message: "Admin role or CRON_SECRET required",
    });
    expect(serviceMock.tickStreaks).not.toHaveBeenCalled();
  });

  it("calls tickStreaks and returns the counts envelope for cron requests", async () => {
    const { POST } = await import("@/app/api/cron/streak-tick/route");

    const response = await POST(
      new Request("http://localhost/api/cron/streak-tick", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(serviceMock.tickStreaks).toHaveBeenCalledWith({
      actorUserId: "22222222-2222-2222-2222-222222222222",
    });
    expect(await response.json()).toEqual({
      evaluated: 2,
      credited: 1,
      frozen: 1,
      reset: 0,
    });
  });
});
