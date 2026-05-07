import "server-only";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { getDashboard } from "@/server/dashboard/service";
import type { DashboardEntity, DashboardResponse } from "@/server/dashboard/types";
import { getFocusQueue, type FocusQueueItem } from "@/server/focus/service";
import { role_enum } from "@/generated/prisma/enums";

export interface DailyGoal {
  completed: number;
  target: number;
  remaining: number;
  percent: number;
}

export interface HomeNudge {
  tone: "warning" | "info" | "success";
  title: string;
  description: string;
  href: string;
}

export interface HomeCommandCenter {
  dashboard: DashboardResponse | null;
  dashboard_error: string | null;
  daily_goal: DailyGoal;
  focus_items: FocusQueueItem[];
  focus_total: number;
  is_read_only: boolean;
  nudges: HomeNudge[];
}

export function buildDailyGoal({
  completed,
  target,
}: {
  completed: number;
  target: number;
}): DailyGoal {
  const safeTarget = Math.max(1, target);
  const safeCompleted = Math.max(0, completed);

  return {
    completed: safeCompleted,
    target: safeTarget,
    remaining: Math.max(0, safeTarget - safeCompleted),
    percent: Math.min(100, Math.round((safeCompleted / safeTarget) * 100)),
  };
}

export function buildHomeNudges({
  brokenPromises,
  highRiskItems,
  reconciliationItems,
}: {
  brokenPromises: number;
  highRiskItems: number;
  reconciliationItems: number;
}): HomeNudge[] {
  const nudges: HomeNudge[] = [];

  if (highRiskItems > 0) {
    nudges.push({
      tone: "warning",
      title: `${highRiskItems} high-risk account${
        highRiskItems === 1 ? "" : "s"
      } ${highRiskItems === 1 ? "needs" : "need"} attention`,
      description: "Prioritize 90+ and high-value receivables first.",
      href: "/collections?system_view=90-plus-high-value",
    });
  }

  if (brokenPromises > 0) {
    nudges.push({
      tone: "info",
      title: `${brokenPromises} promise${
        brokenPromises === 1 ? "" : "s"
      } to pay ${brokenPromises === 1 ? "needs" : "need"} review`,
      description: "Review broken or due promises and choose the next action.",
      href: "/promises-to-pay",
    });
  }

  if (reconciliationItems > 0) {
    nudges.push({
      tone: "warning",
      title: `${reconciliationItems} reconciliation item${
        reconciliationItems === 1 ? "" : "s"
      } ${reconciliationItems === 1 ? "needs" : "need"} review`,
      description: "Resolve mismatch or pending tie-out items before close.",
      href: "/reconciliation",
    });
  }

  if (nudges.length === 0) {
    nudges.push({
      tone: "success",
      title: "No urgent nudges right now",
      description: "Open the focus queue or review published snapshots.",
      href: "/focus",
    });
  }

  return nudges;
}

async function resolveDashboardEntity(
  user: AuthenticatedUser,
): Promise<DashboardEntity> {
  if (user.role !== role_enum.ANALYST) return "ALL";
  if (!user.entityIdScope) return "IND";

  const entity = await getPrisma().entities.findUnique({
    where: { id: user.entityIdScope },
    select: { code: true },
  });

  return entity?.code === "UAE" ? "UAE" : "IND";
}

async function countTodayActions(user: AuthenticatedUser, now: Date) {
  if (user.role === role_enum.CFO) return 0;

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const [auditActions, followUps] = await Promise.all([
    getPrisma().audit_log.count({
      where: {
        actor_user_id: user.id,
        created_at: { gte: start, lt: end },
        action: {
          in: [
            "collection_task.create",
            "collection_task.complete",
            "collection_task.snooze",
            "collection_task.status_change",
            "promise_to_pay.create",
            "promise_to_pay.patch",
            "dispute_case.create",
            "dispute_case.patch",
          ],
        },
      },
    }),
    getPrisma().follow_ups.count({
      where: {
        logged_by: user.id,
        logged_at: { gte: start, lt: end },
      },
    }),
  ]);

  return auditActions + followUps;
}

export async function getHomeCommandCenter(
  user: AuthenticatedUser,
  now = new Date(),
): Promise<HomeCommandCenter> {
  assertNotPending(user);

  const [focus, completed, dashboardEntity] = await Promise.all([
    getFocusQueue({ asOfDate: now, limit: 7 }, user),
    countTodayActions(user, now),
    resolveDashboardEntity(user),
  ]);

  let dashboard: DashboardResponse | null = null;
  let dashboardError: string | null = null;

  try {
    dashboard = await getDashboard({ entity: dashboardEntity, as_of: "latest" });
  } catch (error) {
    dashboardError =
      error instanceof Error ? error.message : "Dashboard data unavailable.";
  }

  const brokenPromises = focus.items.filter((item) => item.type === "PTP").length;
  const highRiskItems = focus.items.filter(
    (item) => item.priority_score >= 85 || item.status.includes("90"),
  ).length;
  const reconciliationItems = focus.items.filter(
    (item) => item.type === "RECONCILIATION",
  ).length;

  return {
    dashboard,
    dashboard_error: dashboardError,
    daily_goal: buildDailyGoal({ completed, target: 10 }),
    focus_items: focus.items,
    focus_total: focus.total,
    is_read_only: focus.is_read_only,
    nudges: buildHomeNudges({
      brokenPromises,
      highRiskItems,
      reconciliationItems,
    }),
  };
}
