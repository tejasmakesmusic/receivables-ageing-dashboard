import "server-only";
import { Prisma } from "@/generated/prisma/client";
import {
  digest_event_state,
  dispute_case_status,
  promise_to_pay_status,
  role_enum,
} from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError } from "@/server/core/errors";

export type Nudge = {
  id: string;
  kind:
    | "ptp_due"
    | "stale_followup"
    | "digest_pending"
    | "reconciliation_unmatched";
  title: string;
  description: string;
  href: string;
  count?: number;
};

function localDateStart(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function daysBefore(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() - days);
  return result;
}

function analystEntityScope(currentUser: AuthenticatedUser) {
  if (currentUser.role !== role_enum.ANALYST) {
    return null;
  }

  if (!currentUser.entityIdScope) {
    throw new ForbiddenError("Analyst user has no entity scope");
  }

  return currentUser.entityIdScope;
}

function promiseTitle(count: number) {
  return count === 1
    ? "1 promise is due today"
    : `${count} promises are due today`;
}

function followUpTitle(count: number) {
  return count === 1
    ? "1 follow-up needs attention"
    : `${count} follow-ups need attention`;
}

export async function buildNudges(
  currentUser: AuthenticatedUser,
): Promise<Nudge[]> {
  if (currentUser.role === role_enum.PENDING) {
    return [];
  }

  const prisma = getPrisma();
  const entityScope = analystEntityScope(currentUser);
  const today = localDateStart(new Date());
  const staleCutoff = daysBefore(today, 7);
  const partyScope = entityScope ? { entity_id: entityScope } : {};
  const ptpWhere: Prisma.promises_to_payWhereInput = {
    status: promise_to_pay_status.OPEN,
    promised_date: { lte: today },
    ...(entityScope
      ? { parties_canonical: { entity_id: entityScope } }
      : {}),
  };
  const activeDisputeStatuses = [
    dispute_case_status.OPEN,
    dispute_case_status.IN_REVIEW,
    dispute_case_status.WAITING_ON_CUSTOMER,
  ];

  const [ptpDueCount, staleFollowUps] = await Promise.all([
    prisma.promises_to_pay.count({ where: ptpWhere }),
    prisma.follow_ups.findMany({
      where: {
        date: { lte: staleCutoff },
        parties_canonical: {
          ...partyScope,
          follow_ups: { none: { date: { gt: staleCutoff } } },
          OR: [
            {
              promises_to_pay: {
                some: { status: promise_to_pay_status.OPEN },
              },
            },
            {
              dispute_cases: {
                some: { status: { in: activeDisputeStatuses } },
              },
            },
          ],
        },
      },
      distinct: ["canonical_id"],
      select: { canonical_id: true },
    }),
  ]);

  const nudges: Nudge[] = [];

  if (ptpDueCount > 0) {
    nudges.push({
      id: "ptp_due",
      kind: "ptp_due",
      title: promiseTitle(ptpDueCount),
      description: "Review open promises with promised dates due today or earlier.",
      href: "/promises-to-pay?status=OPEN",
      count: ptpDueCount,
    });
  }

  if (staleFollowUps.length > 0) {
    nudges.push({
      id: "stale_followup",
      kind: "stale_followup",
      title: followUpTitle(staleFollowUps.length),
      description: "Active disputes or promises have no recent contact logged.",
      href: "/follow-ups",
      count: staleFollowUps.length,
    });
  }

  if (currentUser.role === role_enum.ADMIN) {
    const [digestPendingCount, reconciliationUnmatchedCount] =
      await Promise.all([
        prisma.digest_events.count({
          where: { state: digest_event_state.PREVIEWED },
        }),
        prisma.reconciliation_entries.count({
          where: { status: "MISMATCHED" },
        }),
      ]);

    if (digestPendingCount > 0) {
      nudges.push({
        id: "digest_pending",
        kind: "digest_pending",
        title: "Digest is waiting for your approval",
        description: "A prepared digest event is ready for admin review.",
        href: "/admin/digest",
        count: digestPendingCount,
      });
    }

    if (reconciliationUnmatchedCount > 0) {
      nudges.push({
        id: "reconciliation_unmatched",
        kind: "reconciliation_unmatched",
        title:
          reconciliationUnmatchedCount === 1
            ? "1 snapshot has unmatched reconciliation"
            : `${reconciliationUnmatchedCount} snapshots have unmatched reconciliation`,
        description: "Published snapshots have reconciliation mismatches to review.",
        href: "/admin/reconciliation",
        count: reconciliationUnmatchedCount,
      });
    }
  }

  return nudges;
}
