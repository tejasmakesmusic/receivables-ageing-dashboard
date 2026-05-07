import Link from "next/link";
import { GoalChip } from "@/components/engagement/goal-chip";
import {
  OnboardingChecklist,
  type OnboardingChecklistProps,
} from "@/components/engagement/onboarding-checklist";
import { StreakBadge } from "@/components/engagement/streak-badge";
import { NudgeStack } from "@/components/engagement/nudge-stack";
import { StatusTag } from "@/components/ui/status-tag";
import { collection_task_status, role_enum } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { requirePageRole } from "@/server/core/page-auth";
import {
  FOCUS_QUEUE_PAGE_ROLES,
  getFocusQueue,
  type FocusQueueItem,
} from "@/server/focus/service";

export const dynamic = "force-dynamic";
const DEFAULT_DAILY_TARGET = 10;

type OnboardingCompletion = OnboardingChecklistProps["completion"];

function dayBounds(value: string) {
  const date = new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const start = new Date(safeDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

async function getFocusEngagementState(
  user: AuthenticatedUser,
  generatedAt: string,
): Promise<{
  completedToday: number;
  onboarding: OnboardingCompletion;
}> {
  const prisma = getPrisma();
  const { start, end } = dayBounds(generatedAt);
  const entityScope =
    user.role === role_enum.ANALYST && user.entityIdScope
      ? { entity_id: user.entityIdScope }
      : {};
  const canonicalScope =
    user.role === role_enum.ANALYST && user.entityIdScope
      ? { parties_canonical: { entity_id: user.entityIdScope } }
      : {};
  const taskUserScope = {
    OR: [{ owner_user_id: user.id }, { created_by: user.id }],
  };

  const [
    uploadedSnapshotCount,
    publishedSnapshotCount,
    workedTaskCount,
    completedToday,
    followUpCount,
    promiseCount,
    disputeCount,
  ] = await Promise.all([
    prisma.snapshots.count({
      where: { ...entityScope, uploaded_by: user.id },
    }),
    prisma.snapshots.count({
      where: { ...entityScope, uploaded_by: user.id, status: "PUBLISHED" },
    }),
    prisma.collection_tasks.count({
      where: {
        ...entityScope,
        ...taskUserScope,
        status: collection_task_status.DONE,
      },
    }),
    prisma.collection_tasks.count({
      where: {
        ...entityScope,
        ...taskUserScope,
        completed_at: { gte: start, lt: end },
        status: collection_task_status.DONE,
      },
    }),
    prisma.follow_ups.count({
      where: { ...canonicalScope, logged_by: user.id },
    }),
    prisma.promises_to_pay.count({
      where: { ...canonicalScope, created_by: user.id },
    }),
    prisma.dispute_cases.count({
      where: { ...entityScope, created_by: user.id },
    }),
  ]);

  return {
    completedToday,
    onboarding: {
      uploaded_snapshot: uploadedSnapshotCount > 0,
      resolved_warnings: publishedSnapshotCount > 0,
      worked_task: workedTaskCount > 0,
      logged_follow_up: followUpCount > 0,
      recorded_ptp: promiseCount > 0,
      raised_dispute: disputeCount > 0,
      reviewed_export: publishedSnapshotCount > 0,
    },
  };
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function queueTypeLabel(type: FocusQueueItem["type"]): string {
  switch (type) {
    case "TASK":
      return "Task";
    case "PTP":
      return "PTP";
    case "DISPUTE":
      return "Dispute";
    case "STAGING_BLOCKER":
      return "Staging";
    case "RECONCILIATION":
      return "Reconciliation";
  }
}

function visibleRoleLabel(role: role_enum): string {
  if (role === role_enum.CFO) return "Read-only";
  if (role === role_enum.ADMIN) return "Admin";
  return "Analyst";
}

export default async function FocusPage() {
  const user = await requirePageRole("/focus", ...FOCUS_QUEUE_PAGE_ROLES);
  const queue = await getFocusQueue({}, user);
  const engagement = await getFocusEngagementState(user, queue.generated_at);
  const visibleEntities =
    queue.visible_entity_codes.length > 0
      ? queue.visible_entity_codes.join(", ")
      : "None";

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)]">
      <div className="border-b border-[var(--color-border)] px-[var(--spacing-6)] py-[var(--spacing-4)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--spacing-4)]">
          <div>
            <h1 className="text-base font-semibold text-[var(--color-text)]">
              Focus Queue
            </h1>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {queue.total} open item{queue.total === 1 ? "" : "s"} ·{" "}
              {visibleEntities} · {visibleRoleLabel(user.role)}
            </p>
          </div>
          <div className="flex items-center gap-[var(--spacing-2)] text-xs">
            <span className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-[var(--spacing-2)] py-1 text-[var(--color-text-muted)]">
              {"Today's focus"}
            </span>
            <span className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-[var(--spacing-2)] py-1 font-medium text-[var(--color-text)]">
              {queue.items.length} current
            </span>
            {queue.is_read_only ? (
              <StatusTag status="READ_ONLY" label="Read-only" />
            ) : null}
          </div>
        </div>

        <div className="mt-[var(--spacing-4)] flex flex-wrap items-center justify-between gap-[var(--spacing-3)]">
          <GoalChip
            completed={engagement.completedToday}
            target={DEFAULT_DAILY_TARGET}
          />
          <StreakBadge />
        </div>

        <div className="mt-[var(--spacing-3)]">
          <OnboardingChecklist completion={engagement.onboarding} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <NudgeStack />
        {queue.items.length === 0 ? (
          <div className="flex min-h-72 items-center justify-center px-[var(--spacing-6)] text-sm text-[var(--color-text-muted)]">
            No current focus items for your scope.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
              <tr>
                <th className="px-[var(--spacing-6)] py-[var(--spacing-2)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Work item
                </th>
                <th className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Entity
                </th>
                <th className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Status
                </th>
                <th className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  Due
                </th>
                <th className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-right text-xs font-medium text-[var(--color-text-muted)]">
                  Priority
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {queue.items.map((item) => (
                <tr
                  key={`${item.type}-${item.id}`}
                  className="hover:bg-[var(--color-bg-subtle)]"
                >
                  <td className="px-[var(--spacing-6)] py-[var(--spacing-3)]">
                    <div className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-[var(--spacing-2)]">
                        <span className="rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] px-[var(--spacing-2)] py-0.5 text-xs text-[var(--color-text-muted)]">
                          {queueTypeLabel(item.type)}
                        </span>
                        <Link
                          href={item.href}
                          className="font-medium text-[var(--color-accent)] hover:underline"
                        >
                          {item.title}
                        </Link>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {item.subtitle}
                      </p>
                      <p className="text-xs text-[var(--color-text-subtle)]">
                        {item.reason}
                      </p>
                    </div>
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-[var(--color-text-muted)]">
                    {item.entity_code}
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-3)]">
                    <StatusTag status={item.status} />
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-[var(--color-text-muted)]">
                    {formatDate(item.due_date)}
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-right font-mono text-xs text-[var(--color-text)]">
                    {item.priority_score.toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
