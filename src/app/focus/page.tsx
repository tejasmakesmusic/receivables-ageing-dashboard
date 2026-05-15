import { GoalChip } from "@/components/engagement/goal-chip";
import {
  OnboardingChecklist,
  type OnboardingChecklistProps,
} from "@/components/engagement/onboarding-checklist";
import { StreakBadge } from "@/components/engagement/streak-badge";
import { NudgeStack } from "@/components/engagement/nudge-stack";
import { StatusTag } from "@/components/ui/status-tag";
import { EmptyState } from "@/components/ui/workspace";
import { FocusQueueTable } from "./_components/focus-queue-table";
import { collection_task_status, role_enum } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { requirePageRole } from "@/server/core/page-auth";
import {
  FOCUS_QUEUE_PAGE_ROLES,
  getFocusQueue,
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

function visibleRoleLabel(role: role_enum): string {
  if (role === role_enum.CFO || role === role_enum.REVIEWER) return "Read-only";
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
  const generatedDateKey = new Date(queue.generated_at).toISOString().slice(0, 10);
  const dueNowCount = queue.items.filter((item) => {
    if (!item.due_date) return false;
    return item.due_date <= generatedDateKey;
  }).length;
  const highPriorityCount = queue.items.filter(
    (item) => item.priority_score >= 90,
  ).length;
  const blockerCount = queue.items.filter(
    (item) =>
      item.type === "STAGING_BLOCKER" ||
      item.type === "RECONCILIATION" ||
      item.status === "PTP_BROKEN" ||
      item.status === "DISPUTE_ESCALATED",
  ).length;

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

        <div className="mt-[var(--spacing-3)] flex flex-wrap gap-[var(--spacing-2)]">
          {[
            ["Due now", dueNowCount],
            ["High priority", highPriorityCount],
            ["Blockers", blockerCount],
            ["Completed today", engagement.completedToday],
          ].map(([label, value]) => (
            <span
              className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-[var(--spacing-2)] text-xs text-[var(--color-text-muted)]"
              data-focus-progress-chip={label}
              key={label}
            >
              <span className="font-semibold text-[var(--color-text)]">
                {value}
              </span>
              {label}
            </span>
          ))}
        </div>

        <div className="mt-[var(--spacing-3)]">
          <OnboardingChecklist completion={engagement.onboarding} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <NudgeStack />
        {queue.items.length === 0 ? (
          <div className="px-[var(--spacing-6)] py-[var(--spacing-8)]">
            <EmptyState
              description="No overdue tasks, broken promises, disputes, staging blockers, or reconciliation mismatches need attention in your current scope."
              title="No focus items right now"
            />
          </div>
        ) : (
          <FocusQueueTable items={queue.items} />
        )}
      </div>
    </div>
  );
}
