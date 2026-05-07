import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
  KanbanSquare,
  ListChecks,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/mini-chart";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  ProgressRing,
  RightRail,
  SavedViewLink,
  SavedViewTabs,
} from "@/components/ui/workspace";
import {
  role_enum,
  type collection_task_reason_code,
  type collection_task_status,
} from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { groupCollectionBoard } from "@/server/collection-tasks/board";
import {
  getCollectionTask,
  listCollectionTasks,
} from "@/server/collection-tasks/service";
import { assertNotPending } from "@/server/core/assertNotPending";
import { requirePageRole } from "@/server/core/page-auth";
import {
  buildSystemViewHref,
  getCollectionTaskSystemViewFilter,
  getSystemViewsForSurface,
  parseSystemViewId,
} from "@/server/views/system-views";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CollectionsTab = "board" | "calendar" | "queue";

interface CollectionTaskView {
  canonical_id: string;
  created_at: string;
  due_date: string | null;
  entity_id: string;
  id: string;
  invoice_id: string | null;
  owner_user_id: string | null;
  priority_score: number;
  reason_code: string;
  status: string;
  updated_at: string;
}

const REASON_LABELS: Record<string, string> = {
  BROKEN_PROMISE: "Broken Promise",
  DISPUTE_OPEN: "Open Dispute",
  HIGH_VALUE: "High Value",
  MANUAL: "Manual",
  NINETY_PLUS: "90+ Days",
  STALE_FOLLOW_UP: "Stale Follow-up",
};

const tabIcons = {
  board: KanbanSquare,
  calendar: CalendarDays,
  queue: ListChecks,
} as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTab(value: string | undefined): CollectionsTab {
  return value === "calendar" || value === "queue" ? value : "board";
}

function toTaskView(task: {
  canonical_id: string;
  created_at: Date;
  due_date: Date | null;
  entity_id: string;
  id: string;
  invoice_id: string | null;
  owner_user_id: string | null;
  priority_score: number | { toString: () => string };
  reason_code: string;
  status: string;
  updated_at: Date;
}): CollectionTaskView {
  return {
    canonical_id: task.canonical_id,
    created_at: task.created_at.toISOString(),
    due_date: task.due_date ? task.due_date.toISOString() : null,
    entity_id: task.entity_id,
    id: task.id,
    invoice_id: task.invoice_id,
    owner_user_id: task.owner_user_id,
    priority_score: Number(task.priority_score),
    reason_code: task.reason_code,
    status: task.status,
    updated_at: task.updated_at.toISOString(),
  };
}

function collectionHref(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

function appendTab(href: string, tab: CollectionsTab) {
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  search.set("tab", tab);
  return `${path}?${search.toString()}`;
}

function taskHref(
  taskId: string,
  params: Record<string, string | number | undefined>,
) {
  return collectionHref({ ...params, task: taskId });
}

function reasonLabel(reasonCode: string) {
  return REASON_LABELS[reasonCode] ?? reasonCode.replace(/_/g, " ");
}

function taskStatusTag(status: string) {
  return `TASK_${status}`;
}

function columnAccent(columnId: string) {
  if (columnId === "promise-to-pay") return "var(--color-success)";
  if (columnId === "escalated") return "var(--color-danger)";
  if (columnId === "payment-expected") return "var(--color-warning)";
  if (columnId === "closed") return "var(--color-success)";
  return "var(--color-accent)";
}

function formatOwner(ownerUserId: string | null) {
  return ownerUserId ? `${ownerUserId.slice(0, 8)}...` : "Unassigned";
}

function isDue(task: CollectionTaskView, now: Date) {
  if (!task.due_date) return false;
  return new Date(task.due_date).getTime() <= now.getTime();
}

export default async function CollectionsPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const user = await requirePageRole(
    "/tasks",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const page = Number(first(raw.page) ?? "1");
  const activeTab = parseTab(first(raw.tab));
  const systemViewId = parseSystemViewId(first(raw.system_view));
  const systemViewFilter = getCollectionTaskSystemViewFilter(
    systemViewId,
    new Date(),
  );
  const status = systemViewFilter
    ? undefined
    : (first(raw.status) as collection_task_status | undefined);
  const reasonCode = systemViewFilter
    ? undefined
    : (first(raw.reason_code) as collection_task_reason_code | undefined);
  const ownerUserId =
    first(raw.mine) === "1" ? user.id : first(raw.owner_user_id);

  const { items, page_size: pageSize, total } = await listCollectionTasks(
    {
      canonical_id: first(raw.canonical_id),
      due_date_on_or_before: systemViewFilter?.dueDateOnOrBefore,
      entity_id: first(raw.entity_id),
      owner_user_id: ownerUserId,
      page,
      reason_code: reasonCode,
      reason_codes: systemViewFilter?.reasonCodes,
      status,
      statuses: systemViewFilter?.statuses,
    },
    user,
  );
  const tasks = items.map(toTaskView);
  const board = groupCollectionBoard(tasks);
  const selectedTaskId = first(raw.task);
  const selectedTask =
    selectedTaskId && tasks.every((task) => task.id !== selectedTaskId)
      ? await getCollectionTask(selectedTaskId, user)
          .then(toTaskView)
          .catch(() => null)
      : tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
  const now = new Date();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const systemViews = getSystemViewsForSurface("tasks");
  const closedCount = tasks.filter((task) =>
    ["DONE", "DISMISSED"].includes(task.status),
  ).length;
  const activeCount = tasks.filter((task) =>
    ["SUGGESTED", "OPEN", "IN_PROGRESS", "SNOOZED"].includes(task.status),
  ).length;
  const highPriorityCount = tasks.filter(
    (task) => task.priority_score >= 90,
  ).length;
  const dueCount = tasks.filter((task) => isDue(task, now)).length;
  const completionPercent =
    tasks.length > 0 ? Math.round((closedCount / tasks.length) * 100) : 0;
  const baseParams = {
    mine: first(raw.mine),
    owner_user_id: first(raw.owner_user_id),
    reason_code: first(raw.reason_code),
    status: first(raw.status),
    system_view: systemViewId ?? undefined,
    tab: activeTab,
  };
  const calendarTasks = [...tasks]
    .filter((task) => task.due_date)
    .sort((a, b) =>
      String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")),
    );
  const TabIcon = tabIcons[activeTab];

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/tasks?tab=calendar"
            >
              <CalendarDays className="h-4 w-4" />
              Calendar
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/tasks?tab=queue"
            >
              <ListChecks className="h-4 w-4" />
              Queue
            </Link>
          </>
        }
        title="Tasks"
      >
        Manage follow-ups, promises, disputes, and task ownership from one
        queue.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Tasks" meta={`${total} in current filters`} value={total} />
        <MetricCard label="Active Work" meta="Suggested, open, in progress, snoozed" value={activeCount} />
        <MetricCard label="High Priority" meta="Priority score 90+" value={highPriorityCount} />
        <MetricCard label="Due Now" meta="Due date today or earlier" value={dueCount} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewTabs>
            {(["board", "calendar", "queue"] as const).map((tab) => {
              const Icon = tabIcons[tab];
              return (
                <SavedViewLink
                  active={activeTab === tab}
                  href={collectionHref({ ...baseParams, page: 1, tab })}
                  key={tab}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {tab === "board"
                      ? "Board"
                      : tab === "calendar"
                        ? "Calendar"
                        : "Queue"}
                  </span>
                </SavedViewLink>
              );
            })}
          </SavedViewTabs>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                <TabIcon className="h-4 w-4 text-[var(--color-accent)]" />
                Task Workspace
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  aria-current={!systemViewId ? "page" : undefined}
                  className={[
                    "inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-3 text-sm",
                    !systemViewId
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)]",
                  ].join(" ")}
                  href={collectionHref({ tab: activeTab })}
                >
                  All tasks
                </Link>
                {systemViews.map((view) => (
                  <Link
                    aria-current={systemViewId === view.id ? "page" : undefined}
                    className={[
                      "inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-3 text-sm",
                      systemViewId === view.id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)]",
                    ].join(" ")}
                    href={appendTab(buildSystemViewHref(view.id, "tasks"), activeTab)}
                    key={view.id}
                    title={view.description}
                  >
                    {view.label}
                  </Link>
                ))}
              </div>
            </div>

            <form action="/tasks" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[180px_200px_160px_auto]">
              <input name="tab" type="hidden" value={activeTab} />
              <select
                className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                defaultValue={status ?? ""}
                name="status"
              >
                <option value="">All statuses</option>
                <option value="SUGGESTED">Suggested</option>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="SNOOZED">Snoozed</option>
                <option value="DONE">Done</option>
                <option value="DISMISSED">Dismissed</option>
              </select>
              <select
                className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
                defaultValue={reasonCode ?? ""}
                name="reason_code"
              >
                <option value="">All reasons</option>
                {Object.entries(REASON_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text-muted)]">
                <input defaultChecked={first(raw.mine) === "1"} name="mine" type="checkbox" value="1" />
                My tasks
              </label>
              <Button className="justify-self-start" type="submit" variant="secondary">
                <Filter className="h-4 w-4" />
                Apply Filters
              </Button>
            </form>
          </Panel>

          {activeTab === "board" ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {board.map((column) => {
                const highestPriority = Math.max(
                  0,
                  ...column.tasks.map((task) => task.priority_score),
                );

                return (
                  <section
                    className="flex min-h-[520px] w-[260px] shrink-0 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                    key={column.id}
                  >
                    <div className="border-b border-[var(--color-border)] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-[var(--color-text)]">
                          {column.label}
                        </h2>
                        <span className="rounded-full bg-[var(--color-bg-muted)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                          {column.tasks.length}
                        </span>
                      </div>
                      <div className="mt-3">
                        <ProgressBar value={highestPriority} />
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-3">
                      {column.tasks.length === 0 ? (
                        <div className="grid min-h-32 place-items-center rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-center text-xs text-[var(--color-text-muted)]">
                          No tasks in this lane.
                        </div>
                      ) : (
                        column.tasks.map((task) => (
                          <Link
                            className={[
                              "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm transition-colors hover:border-[var(--color-accent)]",
                              selectedTask?.id === task.id
                                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                                : "",
                            ].join(" ")}
                            href={taskHref(task.id, baseParams)}
                            key={task.id}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold text-[var(--color-text)]">
                                  {reasonLabel(task.reason_code)}
                                </div>
                                <div className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                                  {task.canonical_id.slice(0, 8)}
                                </div>
                              </div>
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: columnAccent(column.id) }}
                              />
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]">
                              <span>Priority</span>
                              <span className="font-semibold text-[var(--color-text)]">
                                {task.priority_score.toFixed(0)}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]">
                              <span>Due</span>
                              <span>{task.due_date ? formatDate(task.due_date) : "No date"}</span>
                            </div>
                            <div className="mt-3">
                              <StatusTag status={taskStatusTag(task.status)} />
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}

          {activeTab === "calendar" ? (
            <Panel>
              <PanelHeader title="Calendar">
                Due dates and snoozed follow-ups from the current task set.
              </PanelHeader>
              <div className="p-4">
                {calendarTasks.length === 0 ? (
                  <EmptyState
                    description="No due dates are present in this task view. Snoozed and scheduled follow-ups will appear here."
                    title="No scheduled work"
                  />
                ) : (
                  <div className="space-y-3">
                    {calendarTasks.map((task) => (
                      <Link
                        className="grid gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 hover:border-[var(--color-accent)] md:grid-cols-[160px_1fr_120px]"
                        href={taskHref(task.id, baseParams)}
                        key={task.id}
                      >
                        <div className="text-sm font-semibold text-[var(--color-text)]">
                          {formatDate(task.due_date)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--color-text)]">
                            {reasonLabel(task.reason_code)}
                          </div>
                          <div className="font-mono text-xs text-[var(--color-text-muted)]">
                            {task.canonical_id.slice(0, 8)}
                          </div>
                        </div>
                        <StatusTag status={taskStatusTag(task.status)} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          ) : null}

          {activeTab === "queue" ? (
            <Panel>
              <PanelHeader title="Queue">
                Dense task list for scanning and review.
              </PanelHeader>
              <TableShell>
                <table className="w-full min-w-[920px] text-sm">
                  <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Party</th>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Priority</th>
                      <th className="px-4 py-3">Due</th>
                      <th className="px-4 py-3">Owner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {tasks.length === 0 ? (
                      <EmptyTableRow colSpan={7}>
                        <EmptyState
                          description="No collection tasks match this view."
                          title="Queue is clear"
                        />
                      </EmptyTableRow>
                    ) : (
                      tasks.map((task) => (
                        <tr
                          className={[
                            "hover:bg-[var(--color-bg-subtle)]",
                            selectedTask?.id === task.id
                              ? "bg-[var(--color-accent-soft)]"
                              : "",
                          ].join(" ")}
                          key={task.id}
                        >
                          <td className="px-4 py-3">
                            <Link
                              className="font-medium text-[var(--color-accent)]"
                              href={taskHref(task.id, baseParams)}
                            >
                              {reasonLabel(task.reason_code)}
                            </Link>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                            {task.canonical_id.slice(0, 8)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                            {task.invoice_id ? task.invoice_id.slice(0, 8) : "-"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusTag status={taskStatusTag(task.status)} />
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {task.priority_score.toFixed(0)}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)]">
                            {task.due_date ? formatDate(task.due_date) : "No date"}
                          </td>
                          <td className="px-4 py-3 text-[var(--color-text-muted)]">
                            {formatOwner(task.owner_user_id)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </TableShell>
            </Panel>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--color-text-muted)]">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Link
                aria-disabled={page <= 1}
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                href={collectionHref({ ...baseParams, page: Math.max(1, page - 1) })}
              >
                Previous
              </Link>
              <Link
                aria-disabled={page >= totalPages}
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                href={collectionHref({ ...baseParams, page: Math.min(totalPages, page + 1) })}
              >
                Next
              </Link>
            </div>
          </div>
        </div>

        <RightRail>
          <Panel>
            <PanelHeader title="Task Progress">
              Current filtered page.
            </PanelHeader>
            <div className="flex items-center gap-5 p-4">
              <ProgressRing label="closed" value={completionPercent} />
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-lg font-semibold text-[var(--color-text)]">
                    {closedCount} / {tasks.length || 0}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    tasks closed in this view
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                  <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
                  {activeCount} tasks still active
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Selected Task">
              {selectedTask ? selectedTask.id.slice(0, 8) : "No task selected"}
            </PanelHeader>
            {selectedTask ? (
              <div className="space-y-4 p-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--color-text)]">
                        {reasonLabel(selectedTask.reason_code)}
                      </h2>
                      <div className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
                        {selectedTask.canonical_id}
                      </div>
                    </div>
                    <StatusTag status={taskStatusTag(selectedTask.status)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Priority
                    </div>
                    <div className="mt-1 font-semibold">
                      {selectedTask.priority_score.toFixed(0)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Due Date
                    </div>
                    <div className="mt-1 font-semibold">
                      {selectedTask.due_date
                        ? formatDate(selectedTask.due_date)
                        : "No date"}
                    </div>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-[var(--color-text-muted)]">
                  <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4" />
                    {formatOwner(selectedTask.owner_user_id)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4" />
                    Updated {formatDate(selectedTask.updated_at)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Link
                    className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                    href={`/party/${selectedTask.canonical_id}`}
                  >
                    Account
                  </Link>
                  {selectedTask.invoice_id ? (
                    <Link
                      className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      href={`/invoice/${selectedTask.invoice_id}`}
                    >
                      Invoice
                    </Link>
                  ) : (
                    <span className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-sm font-medium text-[var(--color-text-muted)]">
                      No invoice
                    </span>
                  )}
                </div>

                {user.role === role_enum.CFO ? (
                  <StatusTag label="Read-only CFO view" status="READ_ONLY" />
                ) : null}
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  description="Select a task card or queue row to inspect ownership, due date, and linked records."
                  title="No task selected"
                />
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Queue Overview">
              Workload signals.
            </PanelHeader>
            <div className="space-y-3 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Total in queue</span>
                <span className="font-semibold">{total}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">High priority</span>
                <span className="font-semibold">{highPriorityCount}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Due now</span>
                <span className="font-semibold">{dueCount}</span>
              </div>
            </div>
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
