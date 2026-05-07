import { beforeEach, describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";

const prismaMock = vi.hoisted(() => ({
  users: { findMany: vi.fn() },
  engagement_streaks: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  engagement_streak_freezes: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  },
  follow_ups: { count: vi.fn() },
  collection_tasks: { count: vi.fn() },
  audit_log: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: vi.fn(() => prismaMock),
}));

const ANALYST_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_USER_ID = "33333333-3333-3333-3333-333333333333";

function makeUser(role: role_enum, id = ANALYST_ID): AuthenticatedUser {
  return {
    id,
    email: `${role.toLowerCase()}@emb.global`,
    name: role,
    role,
    entityIdScope: null,
    isActive: true,
    lastLoginAt: null,
  };
}

function makeStreak(overrides: Record<string, unknown> = {}) {
  return {
    user_id: ANALYST_ID,
    current_streak: 2,
    longest_streak: 4,
    last_credited_date: new Date("2026-05-05T00:00:00.000Z"),
    last_evaluated_at: new Date("2026-05-05T18:30:00.000Z"),
    updated_at: new Date("2026-05-05T18:30:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  prismaMock.users.findMany.mockResolvedValue([
    { id: ANALYST_ID, role: role_enum.ANALYST, is_active: true },
  ]);
  prismaMock.engagement_streaks.findUnique.mockResolvedValue(makeStreak());
  prismaMock.engagement_streaks.create.mockImplementation(({ data }) =>
    Promise.resolve(
      makeStreak({
        user_id: data.user_id,
        current_streak: data.current_streak ?? 0,
        longest_streak: data.longest_streak ?? 0,
        last_credited_date: data.last_credited_date ?? null,
      }),
    ),
  );
  prismaMock.engagement_streaks.update.mockImplementation(({ where, data }) =>
    Promise.resolve(
      makeStreak({
        user_id: where.user_id,
        ...data,
      }),
    ),
  );
  prismaMock.engagement_streak_freezes.findFirst.mockResolvedValue(null);
  prismaMock.engagement_streak_freezes.findMany.mockResolvedValue([]);
  prismaMock.engagement_streak_freezes.create.mockResolvedValue({
    freeze_id: "44444444-4444-4444-4444-444444444444",
    user_id: ANALYST_ID,
    freeze_date: new Date("2026-05-06T00:00:00.000Z"),
    reason: "LEAVE",
    note: "Approved leave",
    created_by: ADMIN_ID,
  });
  prismaMock.follow_ups.count.mockResolvedValue(0);
  prismaMock.collection_tasks.count.mockResolvedValue(0);
  prismaMock.audit_log.create.mockResolvedValue({ id: "audit-id" });
});

describe("engagement streak service", () => {
  it("getStreakForUser creates a default row when missing", async () => {
    prismaMock.engagement_streaks.findUnique.mockResolvedValueOnce(null);
    const { getStreakForUser } = await import("@/server/engagement/streaks");

    const streak = await getStreakForUser(makeUser(role_enum.ANALYST));

    expect(prismaMock.engagement_streaks.create).toHaveBeenCalledWith({
      data: { user_id: ANALYST_ID },
    });
    expect(streak.current_streak).toBe(0);
    expect(streak.longest_streak).toBe(0);
  });

  it("tickStreaks increments on a weekday with completed follow-ups and no overdue tasks", async () => {
    prismaMock.follow_ups.count.mockResolvedValue(1);
    prismaMock.collection_tasks.count.mockImplementation(({ where }) =>
      Promise.resolve(where.status ? 0 : 1),
    );
    const { tickStreaks } = await import("@/server/engagement/streaks");

    const result = await tickStreaks({
      asOfDate: "2026-05-06",
      actorUserId: ADMIN_ID,
    });

    expect(result).toEqual({ evaluated: 1, credited: 1, frozen: 0, reset: 0 });
    expect(prismaMock.engagement_streaks.update).toHaveBeenCalledWith({
      where: { user_id: ANALYST_ID },
      data: expect.objectContaining({
        current_streak: 3,
        longest_streak: 4,
        last_credited_date: new Date("2026-05-06T00:00:00.000Z"),
      }),
    });
  });

  it("tickStreaks resets to 0 with open due tasks at EOD", async () => {
    prismaMock.collection_tasks.count.mockImplementation(({ where }) =>
      Promise.resolve(where.status ? 1 : 1),
    );
    const { tickStreaks } = await import("@/server/engagement/streaks");

    const result = await tickStreaks({
      asOfDate: "2026-05-06",
      actorUserId: ADMIN_ID,
    });

    expect(result).toEqual({ evaluated: 1, credited: 0, frozen: 0, reset: 1 });
    expect(prismaMock.engagement_streaks.update).toHaveBeenCalledWith({
      where: { user_id: ANALYST_ID },
      data: expect.objectContaining({
        current_streak: 0,
      }),
    });
  });

  it("weekend evaluation preserves current_streak and only updates last_evaluated_at", async () => {
    const { tickStreaks } = await import("@/server/engagement/streaks");

    const result = await tickStreaks({
      asOfDate: "2026-05-09",
      actorUserId: ADMIN_ID,
    });

    expect(result).toEqual({ evaluated: 1, credited: 0, frozen: 1, reset: 0 });
    expect(prismaMock.follow_ups.count).not.toHaveBeenCalled();
    expect(prismaMock.collection_tasks.count).not.toHaveBeenCalled();
    expect(prismaMock.engagement_streaks.update).toHaveBeenCalledWith({
      where: { user_id: ANALYST_ID },
      data: { last_evaluated_at: expect.any(Date) },
    });
  });

  it("granted freeze on a weekday preserves current_streak", async () => {
    prismaMock.engagement_streak_freezes.findFirst.mockResolvedValue({
      freeze_id: "freeze-id",
    });
    const { tickStreaks } = await import("@/server/engagement/streaks");

    const result = await tickStreaks({
      asOfDate: "2026-05-06",
      actorUserId: ADMIN_ID,
    });

    expect(result).toEqual({ evaluated: 1, credited: 0, frozen: 1, reset: 0 });
    expect(prismaMock.follow_ups.count).not.toHaveBeenCalled();
    expect(prismaMock.engagement_streaks.update).toHaveBeenCalledWith({
      where: { user_id: ANALYST_ID },
      data: { last_evaluated_at: expect.any(Date) },
    });
  });

  it("keeps longest_streak monotonic when current streak advances below the record", async () => {
    prismaMock.engagement_streaks.findUnique.mockResolvedValue(
      makeStreak({ current_streak: 5, longest_streak: 10 }),
    );
    prismaMock.follow_ups.count.mockResolvedValue(1);
    const { tickStreaks } = await import("@/server/engagement/streaks");

    await tickStreaks({ asOfDate: "2026-05-06", actorUserId: ADMIN_ID });

    expect(prismaMock.engagement_streaks.update).toHaveBeenCalledWith({
      where: { user_id: ANALYST_ID },
      data: expect.objectContaining({
        current_streak: 6,
        longest_streak: 10,
      }),
    });
  });

  it("grantStreakFreeze writes audit_log with before and after JSON", async () => {
    const { grantStreakFreeze } = await import("@/server/engagement/streaks");

    const result = await grantStreakFreeze(
      {
        user_id: ANALYST_ID,
        freeze_date: "2026-05-06",
        reason: "LEAVE",
        note: "Approved leave",
      },
      makeUser(role_enum.ADMIN, ADMIN_ID),
    );

    expect(result).toEqual({
      freeze_id: "44444444-4444-4444-4444-444444444444",
    });
    expect(prismaMock.audit_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "engagement_streak_freeze.grant",
        entity_type: "engagement_streak_freezes",
        entity_id: "44444444-4444-4444-4444-444444444444",
        before: null,
        after: expect.objectContaining({
          user_id: ANALYST_ID,
          freeze_date: "2026-05-06",
          reason: "LEAVE",
          note: "Approved leave",
        }),
        users: { connect: { id: ADMIN_ID } },
      }),
    });
  });

  it("grantStreakFreeze rejects non-ADMIN users", async () => {
    const { grantStreakFreeze } = await import("@/server/engagement/streaks");

    await expect(
      grantStreakFreeze(
        { freeze_date: "2026-05-06", reason: "HOLIDAY" },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(prismaMock.engagement_streak_freezes.create).not.toHaveBeenCalled();
  });

  it("listFreezes scopes analysts to their own freeze rows", async () => {
    prismaMock.engagement_streak_freezes.findMany.mockResolvedValue([
      { freeze_id: "own-freeze", user_id: ANALYST_ID },
    ]);
    const { listFreezes } = await import("@/server/engagement/streaks");

    const rows = await listFreezes(
      { user_id: OTHER_USER_ID, from_date: "2026-05-01", to_date: "2026-05-31" },
      makeUser(role_enum.ANALYST),
    );

    expect(rows).toEqual([{ freeze_id: "own-freeze", user_id: ANALYST_ID }]);
    expect(prismaMock.engagement_streak_freezes.findMany).toHaveBeenCalledWith({
      where: {
        user_id: ANALYST_ID,
        freeze_date: {
          gte: new Date("2026-05-01T00:00:00.000Z"),
          lte: new Date("2026-05-31T00:00:00.000Z"),
        },
      },
      orderBy: { freeze_date: "desc" },
    });
  });
});
