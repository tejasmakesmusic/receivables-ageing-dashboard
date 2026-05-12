import "server-only";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { createAuditLog } from "@/server/core/audit";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { collection_task_status, role_enum } from "@/generated/prisma/enums";

export type StreakFreezeReason = "HOLIDAY" | "LEAVE" | "SYSTEM_DOWNTIME" | "MANUAL";

export type StreakState = {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_credited_date: Date | null;
  last_evaluated_at: Date;
  updated_at: Date;
};

export type TickStreaksResult = {
  evaluated: number;
  credited: number;
  frozen: number;
  reset: number;
};

type TickStreaksInput = {
  asOfDate?: string | Date;
  actorUserId: string;
};

type GrantStreakFreezeInput = {
  user_id?: string | null;
  freeze_date: string | Date;
  reason: StreakFreezeReason | string;
  note?: string | null;
};

type ListFreezesInput = {
  user_id?: string;
  from_date?: string | Date;
  to_date?: string | Date;
};

type EngagementFreezeRow = {
  freeze_id: string;
  user_id: string | null;
  freeze_date: Date;
  reason: string;
  note: string | null;
  created_by: string;
  created_at?: Date;
};

type EngagementFreezeWhere = {
  user_id?: string;
  freeze_date?: { gte?: Date; lte?: Date };
};

type EngagementPrisma = {
  users: {
    findMany(args: {
      where: { is_active: true; role: { in: role_enum[] } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  engagement_streaks: {
    findUnique(args: { where: { user_id: string } }): Promise<StreakState | null>;
    create(args: {
      data: {
        user_id: string;
        current_streak?: number;
        longest_streak?: number;
        last_credited_date?: Date | null;
        last_evaluated_at?: Date;
      };
    }): Promise<StreakState>;
    update(args: {
      where: { user_id: string };
      data: Partial<
        Pick<
          StreakState,
          | "current_streak"
          | "longest_streak"
          | "last_credited_date"
          | "last_evaluated_at"
        >
      >;
    }): Promise<StreakState>;
  };
  engagement_streak_freezes: {
    findFirst(args: {
      where: {
        freeze_date: Date;
        OR: Array<{ user_id: string } | { user_id: null }>;
      };
      select: { freeze_id: true };
    }): Promise<{ freeze_id: string } | null>;
    findMany(args: {
      where: EngagementFreezeWhere;
      orderBy: { freeze_date: "desc" };
    }): Promise<EngagementFreezeRow[]>;
    create(args: {
      data: {
        user_id: string | null;
        freeze_date: Date;
        reason: string;
        note: string | null;
        created_by: string;
      };
    }): Promise<EngagementFreezeRow>;
  };
  follow_ups: {
    count(args: {
      where: {
        logged_by: string;
        logged_at: { gte: Date; lte: Date };
      };
    }): Promise<number>;
  };
  collection_tasks: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

const IST_OFFSET_MS = 330 * 60 * 1000;
const ACTIVE_STREAK_ROLES: role_enum[] = [
  role_enum.ANALYST,
  role_enum.CFO,
  role_enum.ADMIN,
];

function assertDateOnly(value: string, fieldName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(
      "validation_error",
      400,
      `${fieldName} must be a valid YYYY-MM-DD date`,
    );
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(
      "validation_error",
      400,
      `${fieldName} must be a valid YYYY-MM-DD date`,
    );
  }

  return value;
}

function toIstDateKey(value?: string | Date): string {
  if (typeof value === "string") {
    return assertDateOnly(value, "asOfDate");
  }

  const instant = value ?? new Date();
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function toDateOnly(value: string | Date, fieldName: string): Date {
  const dateKey =
    typeof value === "string"
      ? assertDateOnly(value, fieldName)
      : new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

  return new Date(`${dateKey}T00:00:00.000Z`);
}

function istDayBounds(dateKey: string) {
  return {
    start: new Date(`${dateKey}T00:00:00.000+05:30`),
    end: new Date(`${dateKey}T23:59:59.999+05:30`),
  };
}

function isWeekendDateKey(dateKey: string): boolean {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function sameDateKey(date: Date | null, dateKey: string): boolean {
  return date?.toISOString().slice(0, 10) === dateKey;
}

function getEngagementPrisma(): EngagementPrisma {
  return getPrisma() as unknown as EngagementPrisma;
}

async function ensureStreakRow(userId: string): Promise<StreakState> {
  const prisma = getEngagementPrisma();
  const existing = await prisma.engagement_streaks.findUnique({
    where: { user_id: userId },
  });

  if (existing) {
    return existing;
  }

  return prisma.engagement_streaks.create({
    data: { user_id: userId },
  });
}

async function preserveStreak(userId: string, lastEvaluatedAt: Date) {
  const prisma = getEngagementPrisma();
  const streak = await prisma.engagement_streaks.findUnique({
    where: { user_id: userId },
  });

  if (!streak) {
    await prisma.engagement_streaks.create({
      data: {
        user_id: userId,
        last_evaluated_at: lastEvaluatedAt,
      },
    });
    return;
  }

  await prisma.engagement_streaks.update({
    where: { user_id: userId },
    data: { last_evaluated_at: lastEvaluatedAt },
  });
}

export async function getStreakForUser(
  currentUser: AuthenticatedUser,
): Promise<StreakState> {
  assertNotPending(currentUser);

  if (!ACTIVE_STREAK_ROLES.includes(currentUser.role)) {
    throw new ForbiddenError("User does not have access to engagement streaks");
  }

  const prisma = getEngagementPrisma();
  const existing = await prisma.engagement_streaks.findUnique({
    where: { user_id: currentUser.id },
  });

  if (existing) {
    return existing;
  }

  return prisma.engagement_streaks.create({
    data: { user_id: currentUser.id },
  });
}

export async function tickStreaks(
  input: TickStreaksInput,
): Promise<TickStreaksResult> {
  void input.actorUserId;

  const prisma = getEngagementPrisma();
  const dateKey = toIstDateKey(input.asOfDate);
  const dateOnly = new Date(`${dateKey}T00:00:00.000Z`);
  const { start, end } = istDayBounds(dateKey);
  const isWeekend = isWeekendDateKey(dateKey);
  const result: TickStreaksResult = {
    evaluated: 0,
    credited: 0,
    frozen: 0,
    reset: 0,
  };

  const activeUsers = await prisma.users.findMany({
    where: {
      is_active: true,
      role: { in: [...ACTIVE_STREAK_ROLES] },
    },
    select: { id: true },
  });

  for (const user of activeUsers) {
    result.evaluated++;
    const lastEvaluatedAt = new Date();

    if (isWeekend) {
      await preserveStreak(user.id, lastEvaluatedAt);
      result.frozen++;
      continue;
    }

    const freeze = await prisma.engagement_streak_freezes.findFirst({
      where: {
        freeze_date: dateOnly,
        OR: [{ user_id: user.id }, { user_id: null }],
      },
      select: { freeze_id: true },
    });

    if (freeze) {
      await preserveStreak(user.id, lastEvaluatedAt);
      result.frozen++;
      continue;
    }

    const streak = await ensureStreakRow(user.id);
    const followUpsLogged = await prisma.follow_ups.count({
      where: {
        logged_by: user.id,
        logged_at: {
          gte: start,
          lte: end,
        },
      },
    });
    const tasksDueToday = await prisma.collection_tasks.count({
      where: {
        owner_user_id: user.id,
        due_date: dateOnly,
      },
    });
    const openDueAtEndOfDay = await prisma.collection_tasks.count({
      where: {
        owner_user_id: user.id,
        due_date: { lte: dateOnly },
        status: {
          in: [
            collection_task_status.OPEN,
            collection_task_status.IN_PROGRESS,
          ],
        },
      },
    });

    const qualifiesForCredit =
      (followUpsLogged > 0 || tasksDueToday === 0) && openDueAtEndOfDay === 0;

    if (qualifiesForCredit) {
      const alreadyCredited = sameDateKey(streak.last_credited_date, dateKey);
      const currentStreak = alreadyCredited
        ? streak.current_streak
        : streak.current_streak + 1;

      await prisma.engagement_streaks.update({
        where: { user_id: user.id },
        data: {
          current_streak: currentStreak,
          longest_streak: Math.max(streak.longest_streak, currentStreak),
          last_credited_date: dateOnly,
          last_evaluated_at: lastEvaluatedAt,
        },
      });
      result.credited++;
      continue;
    }

    await prisma.engagement_streaks.update({
      where: { user_id: user.id },
      data: {
        current_streak: 0,
        last_evaluated_at: lastEvaluatedAt,
      },
    });
    result.reset++;
  }

  return result;
}

export async function grantStreakFreeze(
  input: GrantStreakFreezeInput,
  currentUser: AuthenticatedUser,
): Promise<{ freeze_id: string }> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new ForbiddenError("ADMIN role required to grant streak freeze");
  }

  const freezeDate = toDateOnly(input.freeze_date, "freeze_date");
  const created = await getEngagementPrisma().engagement_streak_freezes.create({
    data: {
      user_id: input.user_id ?? null,
      freeze_date: freezeDate,
      reason: input.reason,
      note: input.note ?? null,
      created_by: currentUser.id,
    },
  });
  const after = {
    user_id: input.user_id ?? null,
    freeze_date: freezeDate.toISOString().slice(0, 10),
    reason: input.reason,
    note: input.note ?? null,
    created_by: currentUser.id,
  };

  await createAuditLog(
    currentUser.id,
    "engagement_streak_freeze.grant",
    "engagement_streak_freezes",
    created.freeze_id,
    null,
    after,
  );

  return { freeze_id: created.freeze_id };
}

export async function listFreezes(
  input: ListFreezesInput,
  currentUser: AuthenticatedUser,
) {
  assertNotPending(currentUser);

  if (
    currentUser.role === role_enum.CFO ||
    currentUser.role === role_enum.REVIEWER
  ) {
    throw new ForbiddenError(
      `${currentUser.role} users cannot list engagement freezes`,
    );
  }

  if (
    currentUser.role !== role_enum.ANALYST &&
    currentUser.role !== role_enum.ADMIN
  ) {
    throw new ForbiddenError("User does not have access to engagement freezes");
  }

  const freezeDate: { gte?: Date; lte?: Date } = {};

  if (input.from_date) {
    freezeDate.gte = toDateOnly(input.from_date, "from_date");
  }

  if (input.to_date) {
    freezeDate.lte = toDateOnly(input.to_date, "to_date");
  }

  const where: EngagementFreezeWhere = {
    ...(currentUser.role === role_enum.ANALYST
      ? { user_id: currentUser.id }
      : input.user_id
        ? { user_id: input.user_id }
        : {}),
    ...(Object.keys(freezeDate).length > 0
      ? { freeze_date: freezeDate }
      : {}),
  };

  return getEngagementPrisma().engagement_streak_freezes.findMany({
    where,
    orderBy: { freeze_date: "desc" },
  });
}
