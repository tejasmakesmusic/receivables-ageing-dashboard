import "server-only";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { ForbiddenError } from "@/server/core/errors";
import {
  collection_task_reason_code,
  collection_task_status,
  dispute_case_status,
  promise_to_pay_status,
  role_enum,
} from "@/generated/prisma/enums";

export const FOCUS_QUEUE_PAGE_ROLES = [
  role_enum.ANALYST,
  role_enum.CFO,
  role_enum.ADMIN,
] as const;

export type FocusQueuePageRole = (typeof FOCUS_QUEUE_PAGE_ROLES)[number];
export type FocusQueueEntityCode = "IND" | "UAE";

export type FocusQueueItemType =
  | "TASK"
  | "PTP"
  | "DISPUTE"
  | "STAGING_BLOCKER"
  | "RECONCILIATION";

export interface FocusQueueItem {
  id: string;
  type: FocusQueueItemType;
  entity_code: FocusQueueEntityCode;
  title: string;
  subtitle: string;
  priority_score: number;
  reason: string;
  href: string;
  due_date: string | null;
  status: string;
}

export interface FocusQueueQuery {
  asOfDate?: Date;
  limit?: number;
}

export interface FocusQueueResponse {
  items: FocusQueueItem[];
  total: number;
  visible_entity_codes: FocusQueueEntityCode[];
  is_read_only: boolean;
  generated_at: string;
}

type EntityLinkedRow = {
  entity_id?: string | null;
  entities?: { code?: string | null } | null;
  parties_canonical?: {
    entity_id?: string | null;
    name?: string | null;
    entities?: { code?: string | null } | null;
  } | null;
};

type ParseResultLike = {
  invoices?: unknown[];
  credit_periods?: unknown[];
  errors?: unknown[];
  warnings?: unknown[];
};

type StagingRowLike = {
  status?: unknown;
  alias_resolution?: { resolutionState?: unknown };
  analyst_overrides?: { dismissed?: unknown };
};

type WarningLike = {
  code?: unknown;
};

export function isFocusQueuePageRole(role: role_enum): role is FocusQueuePageRole {
  return FOCUS_QUEUE_PAGE_ROLES.includes(role as FocusQueuePageRole);
}

function dateKey(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeEntityCode(value: string | null | undefined) {
  return value === "IND" || value === "UAE" ? value : null;
}

function entityCodeFor(row: EntityLinkedRow): FocusQueueEntityCode | null {
  return normalizeEntityCode(
    row.entities?.code ?? row.parties_canonical?.entities?.code,
  );
}

function isVisibleToUser(row: EntityLinkedRow, user: AuthenticatedUser): boolean {
  return (
    user.role !== role_enum.ANALYST ||
    (!!user.entityIdScope && row.entity_id === user.entityIdScope) ||
    (!!user.entityIdScope &&
      row.parties_canonical?.entity_id === user.entityIdScope)
  );
}

function itemSortKey(item: FocusQueueItem) {
  return [
    -item.priority_score,
    item.due_date ?? "9999-12-31",
    item.entity_code,
    item.id,
  ].join("|");
}

function uniqueVisibleEntityCodes(
  items: FocusQueueItem[],
): FocusQueueEntityCode[] {
  const codes = new Set(items.map((item) => item.entity_code));
  return (["IND", "UAE"] as const).filter((code) => codes.has(code));
}

function formatAmount(amount: unknown, currency: string | null | undefined) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return currency ?? "";
  return `${currency ?? ""} ${numeric.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`.trim();
}

function isDismissedStagingRow(row: StagingRowLike): boolean {
  return row.analyst_overrides?.dismissed === true;
}

function arrayFromJson(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseResultFromJson(value: unknown): ParseResultLike {
  return value && typeof value === "object" ? (value as ParseResultLike) : {};
}

function warningCode(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const code = (value as WarningLike).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

function countStagingBlockers(snapshot: {
  parse_result_json?: unknown;
  staging_overrides_json?: unknown;
  warnings_acknowledged_json?: unknown;
}): number {
  const parseResult = parseResultFromJson(snapshot.parse_result_json);
  const rows = [
    ...arrayFromJson(parseResult.invoices),
    ...arrayFromJson(parseResult.credit_periods),
  ] as StagingRowLike[];
  const dismissedRows = new Set(
    arrayFromJson(snapshot.staging_overrides_json)
      .filter((override) => {
        if (!override || typeof override !== "object") return false;
        return (override as StagingRowLike).analyst_overrides?.dismissed === true;
      })
      .map((override) => String((override as { row_index?: unknown }).row_index)),
  );

  const unresolvedParseErrors = rows.filter((row) => {
    const rowIndex =
      "row_index" in row ? String((row as { row_index?: unknown }).row_index) : "";
    return (
      row.status === "PARSE_ERROR" &&
      !isDismissedStagingRow(row) &&
      !dismissedRows.has(rowIndex)
    );
  }).length;
  const unresolvedAliases = rows.filter((row) => {
    if (row.status === "PARSE_ERROR") return false;
    const state = row.alias_resolution?.resolutionState;
    return state === "UNMAPPED" || state === "FUZZY_HIGH";
  }).length;
  const fileErrors = arrayFromJson(parseResult.errors).length;
  const acknowledgedWarnings = new Set(
    arrayFromJson(snapshot.warnings_acknowledged_json)
      .map(warningCode)
      .filter((code): code is string => !!code),
  );
  const unacknowledgedWarnings = arrayFromJson(parseResult.warnings)
    .map(warningCode)
    .filter((code): code is string => !!code)
    .filter((code) => !acknowledgedWarnings.has(code)).length;

  return (
    unresolvedParseErrors +
    unresolvedAliases +
    fileErrors +
    unacknowledgedWarnings
  );
}

function mapTask(row: {
  id: string;
  entity_id: string;
  canonical_id: string;
  invoice_id: string | null;
  reason_code: string;
  priority_score: unknown;
  status: string;
  due_date: Date | null;
  entities?: { code?: string | null } | null;
  parties_canonical?: { name?: string | null } | null;
  invoices?: { invoice_ref?: string | null } | null;
}): FocusQueueItem | null {
  const entityCode = entityCodeFor(row);
  if (!entityCode) return null;
  const partyName = row.parties_canonical?.name ?? row.canonical_id;
  const invoiceRef = row.invoices?.invoice_ref;
  const priority = Number(row.priority_score);

  return {
    id: row.id,
    type: "TASK",
    entity_code: entityCode,
    title: invoiceRef ? `${partyName} - ${invoiceRef}` : partyName,
    subtitle: row.reason_code.replace(/_/g, " "),
    priority_score: Number.isFinite(priority) ? priority : 0,
    reason:
      row.reason_code === collection_task_reason_code.NINETY_PLUS
        ? `90+ collection task at priority ${Math.round(priority)}`
        : `Collection task due ${dateKey(row.due_date) ?? "without a due date"}`,
    href: `/tasks?task=${encodeURIComponent(row.id)}`,
    due_date: dateKey(row.due_date),
    status: `TASK_${row.status}`,
  };
}

function mapFollowUp(row: {
  id: string;
  canonical_id: string;
  invoice_id: string | null;
  next_action_date: Date | null;
  channel: string;
  parties_canonical?: {
    entity_id?: string | null;
    name?: string | null;
    entities?: { code?: string | null } | null;
  } | null;
  invoices?: { invoice_ref?: string | null } | null;
}): FocusQueueItem | null {
  const entityCode = entityCodeFor(row);
  if (!entityCode) return null;
  const partyName = row.parties_canonical?.name ?? row.canonical_id;
  const dueDate = dateKey(row.next_action_date);

  return {
    id: row.id,
    type: "TASK",
    entity_code: entityCode,
    title: `Follow up: ${partyName}`,
    subtitle: row.invoices?.invoice_ref
      ? `${row.channel} - ${row.invoices.invoice_ref}`
      : row.channel,
    priority_score: 72,
    reason: `Next action due ${dueDate ?? "now"}`,
    href: `/follow-ups?canonical_id=${encodeURIComponent(row.canonical_id)}`,
    due_date: dueDate,
    status: "FOLLOW_UP_DUE",
  };
}

function mapPtp(row: {
  id: string;
  canonical_id: string;
  invoice_id: string | null;
  amount: unknown;
  currency: string;
  promised_date: Date;
  status: string;
  parties_canonical?: {
    entity_id?: string | null;
    name?: string | null;
    entities?: { code?: string | null } | null;
  } | null;
  invoices?: { invoice_ref?: string | null } | null;
}): FocusQueueItem | null {
  const entityCode = entityCodeFor(row);
  if (!entityCode) return null;
  const partyName = row.parties_canonical?.name ?? row.canonical_id;

  return {
    id: row.id,
    type: "PTP",
    entity_code: entityCode,
    title: `Broken PTP: ${partyName}`,
    subtitle: `${formatAmount(row.amount, row.currency)} promised ${dateKey(
      row.promised_date,
    )}`,
    priority_score: 95,
    reason: "Promise date has passed and status is BROKEN",
    href: `/promises-to-pay?canonical_id=${encodeURIComponent(row.canonical_id)}`,
    due_date: dateKey(row.promised_date),
    status: `PTP_${row.status}`,
  };
}

function mapDispute(row: {
  id: string;
  entity_id: string;
  canonical_id: string;
  invoice_id: string | null;
  reason_code: string;
  description: string;
  status: string;
  expected_resolution_date: Date | null;
  entities?: { code?: string | null } | null;
  parties_canonical?: { name?: string | null } | null;
  invoices?: { invoice_ref?: string | null } | null;
}): FocusQueueItem | null {
  const entityCode = entityCodeFor(row);
  if (!entityCode) return null;
  const partyName = row.parties_canonical?.name ?? row.canonical_id;
  const priority =
    row.status === dispute_case_status.IN_REVIEW
      ? 84
      : row.status === dispute_case_status.WAITING_ON_CUSTOMER
        ? 76
        : 80;

  return {
    id: row.id,
    type: "DISPUTE",
    entity_code: entityCode,
    title: `Dispute: ${partyName}`,
    subtitle: row.invoices?.invoice_ref
      ? `${row.reason_code} - ${row.invoices.invoice_ref}`
      : row.reason_code,
    priority_score: priority,
    reason: `Dispute is ${row.status.replace(/_/g, " ")}`,
    href: `/dispute-cases?entity_id=${encodeURIComponent(row.entity_id)}`,
    due_date: dateKey(row.expected_resolution_date),
    status: `DISPUTE_${row.status}`,
  };
}

function mapStaging(snapshot: {
  id: string;
  entity_id: string;
  as_of_date: Date | null;
  source_hint: string;
  parse_result_json?: unknown;
  staging_overrides_json?: unknown;
  warnings_acknowledged_json?: unknown;
  entities?: { code?: string | null } | null;
}): FocusQueueItem | null {
  const entityCode = entityCodeFor(snapshot);
  if (!entityCode) return null;
  const blockerCount = countStagingBlockers(snapshot);
  if (blockerCount === 0) return null;

  return {
    id: snapshot.id,
    type: "STAGING_BLOCKER",
    entity_code: entityCode,
    title: `${snapshot.source_hint} staging blockers`,
    subtitle: `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`,
    priority_score: 90,
    reason: "Staged snapshot has unresolved parser, alias, or warning blockers",
    href: `/snapshots/${encodeURIComponent(snapshot.id)}/staging`,
    due_date: dateKey(snapshot.as_of_date),
    status: "STAGING_BLOCKED",
  };
}

function mapReconciliation(snapshot: {
  id: string;
  entity_id: string;
  as_of_date: Date | null;
  source_hint: string;
  entities?: { code?: string | null } | null;
  reconciliation_entries?: { status?: string | null; delta?: unknown } | null;
}): FocusQueueItem | null {
  const entityCode = entityCodeFor(snapshot);
  if (!entityCode) return null;
  const status = snapshot.reconciliation_entries?.status ?? "UNRECONCILED";
  if (status !== "MISMATCHED" && status !== "UNRECONCILED") return null;
  const priority = status === "MISMATCHED" ? 88 : 66;

  return {
    id: snapshot.id,
    type: "RECONCILIATION",
    entity_code: entityCode,
    title:
      status === "MISMATCHED"
        ? "Reconciliation mismatch"
        : "Reconciliation pending",
    subtitle: `${snapshot.source_hint} snapshot ${dateKey(snapshot.as_of_date) ?? ""}`.trim(),
    priority_score: priority,
    reason:
      status === "MISMATCHED"
        ? "Dashboard AR does not match entered Tally/Xero AR"
        : "Published snapshot needs reconciliation entry",
    href: `/snapshots/${encodeURIComponent(snapshot.id)}`,
    due_date: dateKey(snapshot.as_of_date),
    status: status === "MISMATCHED" ? "MISMATCH" : "UNRECONCILED",
  };
}

export async function getFocusQueue(
  query: FocusQueueQuery,
  currentUser: AuthenticatedUser,
): Promise<FocusQueueResponse> {
  assertNotPending(currentUser);

  if (currentUser.role === role_enum.ANALYST && !currentUser.entityIdScope) {
    throw new ForbiddenError("Analyst user has no entity scope");
  }

  const prisma = getPrisma();
  const asOfDate = query.asOfDate ?? new Date();
  const limit = query.limit ?? 50;
  const entityScope =
    currentUser.role === role_enum.ANALYST
      ? { entity_id: currentUser.entityIdScope! }
      : {};
  const canonicalEntityScope =
    currentUser.role === role_enum.ANALYST
      ? { parties_canonical: { entity_id: currentUser.entityIdScope! } }
      : {};

  const [tasks, followUps, ptps, disputes, stagedSnapshots, publishedSnapshots] =
    await Promise.all([
      prisma.collection_tasks.findMany({
        where: {
          ...entityScope,
          status: {
            in: [
              collection_task_status.SUGGESTED,
              collection_task_status.OPEN,
              collection_task_status.IN_PROGRESS,
              collection_task_status.SNOOZED,
            ],
          },
          OR: [
            { due_date: { lte: asOfDate } },
            { reason_code: collection_task_reason_code.NINETY_PLUS },
            { priority_score: { gte: 80 } },
          ],
        },
        include: {
          entities: { select: { code: true } },
          parties_canonical: { select: { name: true } },
          invoices: { select: { invoice_ref: true } },
        },
        orderBy: [{ priority_score: "desc" }, { due_date: "asc" }],
        take: 100,
      }),
      prisma.follow_ups.findMany({
        where: {
          ...canonicalEntityScope,
          next_action_date: { lte: asOfDate },
        },
        include: {
          parties_canonical: {
            select: {
              entity_id: true,
              name: true,
              entities: { select: { code: true } },
            },
          },
          invoices: { select: { invoice_ref: true } },
        },
        orderBy: { next_action_date: "asc" },
        take: 100,
      }),
      prisma.promises_to_pay.findMany({
        where: {
          ...canonicalEntityScope,
          status: promise_to_pay_status.BROKEN,
        },
        include: {
          parties_canonical: {
            select: {
              entity_id: true,
              name: true,
              entities: { select: { code: true } },
            },
          },
          invoices: { select: { invoice_ref: true } },
        },
        orderBy: { promised_date: "asc" },
        take: 100,
      }),
      prisma.dispute_cases.findMany({
        where: {
          ...entityScope,
          status: {
            in: [
              dispute_case_status.OPEN,
              dispute_case_status.IN_REVIEW,
              dispute_case_status.WAITING_ON_CUSTOMER,
            ],
          },
        },
        include: {
          entities: { select: { code: true } },
          parties_canonical: { select: { name: true } },
          invoices: { select: { invoice_ref: true } },
        },
        orderBy: { updated_at: "desc" },
        take: 100,
      }),
      prisma.snapshots.findMany({
        where: {
          ...entityScope,
          status: "STAGED",
        },
        include: {
          entities: { select: { code: true } },
        },
        orderBy: { uploaded_at: "desc" },
        take: 50,
      }),
      prisma.snapshots.findMany({
        where: {
          ...entityScope,
          status: "PUBLISHED",
        },
        include: {
          entities: { select: { code: true } },
          reconciliation_entries: {
            select: { status: true, delta: true },
          },
        },
        orderBy: { as_of_date: "desc" },
        take: 50,
      }),
    ]);

  const items = [
    ...tasks
      .filter((row) => isVisibleToUser(row, currentUser))
      .map(mapTask)
      .filter((item): item is FocusQueueItem => !!item),
    ...followUps
      .filter((row) => isVisibleToUser(row, currentUser))
      .map(mapFollowUp)
      .filter((item): item is FocusQueueItem => !!item),
    ...ptps
      .filter((row) => isVisibleToUser(row, currentUser))
      .map(mapPtp)
      .filter((item): item is FocusQueueItem => !!item),
    ...disputes
      .filter((row) => isVisibleToUser(row, currentUser))
      .map(mapDispute)
      .filter((item): item is FocusQueueItem => !!item),
    ...stagedSnapshots
      .filter((row) => isVisibleToUser(row, currentUser))
      .map(mapStaging)
      .filter((item): item is FocusQueueItem => !!item),
    ...publishedSnapshots
      .filter((row) => isVisibleToUser(row, currentUser))
      .map(mapReconciliation)
      .filter((item): item is FocusQueueItem => !!item),
  ].sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));

  const limitedItems = items.slice(0, limit);

  return {
    items: limitedItems,
    total: items.length,
    visible_entity_codes: uniqueVisibleEntityCodes(limitedItems),
    is_read_only: currentUser.role === role_enum.CFO,
    generated_at: asOfDate.toISOString(),
  };
}
