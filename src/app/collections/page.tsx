import { Suspense } from "react";
import { requirePageRole } from "@/server/core/page-auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listCollectionTasks, getCollectionTask } from "@/server/collection-tasks/service";
import { role_enum } from "@/generated/prisma/enums";
import type { collection_task_status, collection_task_reason_code } from "@/generated/prisma/enums";
import {
  buildSystemViewHref,
  getCollectionTaskSystemViewFilter,
  getSystemViewsForSurface,
  parseSystemViewId,
} from "@/server/views/system-views";
import { TaskTable } from "./_components/task-table";
import { TaskFilters } from "./_components/task-filters";
import { TaskSidePanel } from "./_components/task-side-panel";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const resolvedParams = await searchParams;

  // Auth guard — unauthenticated → login, wrong role → 403, pending → /auth/pending
  const user = await requirePageRole(
    "/collections",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const page = resolvedParams.page ? Number(resolvedParams.page) : 1;
  const systemViewId = parseSystemViewId(resolvedParams.system_view);
  const systemViewFilter = getCollectionTaskSystemViewFilter(
    systemViewId,
    new Date(),
  );
  const status = systemViewFilter
    ? undefined
    : (resolvedParams.status as collection_task_status | undefined);
  const reasonCode = systemViewFilter
    ? undefined
    : (resolvedParams.reason_code as collection_task_reason_code | undefined);
  const entityId = resolvedParams.entity_id ?? undefined;
  const canonicalId = resolvedParams.canonical_id ?? undefined;
  const ownerUserId =
    resolvedParams.mine === "1" ? user.id : (resolvedParams.owner_user_id ?? undefined);

  const { items: tasks, total } = await listCollectionTasks(
    {
      entity_id: entityId,
      canonical_id: canonicalId,
      status,
      statuses: systemViewFilter?.statuses,
      reason_code: reasonCode,
      reason_codes: systemViewFilter?.reasonCodes,
      owner_user_id: ownerUserId,
      due_date_on_or_before: systemViewFilter?.dueDateOnOrBefore,
      page,
    },
    user,
  );

  // Load selected task for side panel
  let selectedTask = null;
  if (resolvedParams.task) {
    try {
      selectedTask = await getCollectionTask(resolvedParams.task, user);
    } catch {
      // task not found or not accessible — panel stays closed
    }
  }

  const pageSize = 50;
  const totalPages = Math.ceil(total / pageSize);
  const systemViews = getSystemViewsForSurface("collections");
  const activeSystemViewId = systemViewFilter ? systemViewId : null;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-[var(--spacing-6)] py-[var(--spacing-4)] border-b border-[var(--color-border)]">
        <div>
          <h1 className="text-base font-semibold text-[var(--color-text)]">
            Collections Workbench
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {total} task{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <nav
        aria-label="System views"
        className="flex flex-wrap gap-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-3)] border-b border-[var(--color-border)]"
      >
        <a
          aria-current={!activeSystemViewId ? "page" : undefined}
          className={[
            "rounded-[var(--radius-sm)] border px-[var(--spacing-3)] py-[var(--spacing-1)] text-sm transition-colors",
            !activeSystemViewId
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]",
          ].join(" ")}
          href="/collections"
        >
          All tasks
        </a>
        {systemViews.map((view) => {
          const active = activeSystemViewId === view.id;

          return (
            <a
              aria-current={active ? "page" : undefined}
              className={[
                "rounded-[var(--radius-sm)] border px-[var(--spacing-3)] py-[var(--spacing-1)] text-sm transition-colors",
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                  : "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]",
              ].join(" ")}
              href={buildSystemViewHref(view.id, "collections")}
              key={view.id}
              title={view.description}
            >
              {view.label}
            </a>
          );
        })}
      </nav>

      {/* Filters */}
      <Suspense>
        <TaskFilters />
      </Suspense>

      {/* Main content + side panel */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <TaskTable
            tasks={tasks.map((t) => ({
              ...t,
              due_date: t.due_date ? t.due_date.toISOString() : null,
              created_at: t.created_at.toISOString(),
              priority_score: Number(t.priority_score),
            }))}
            selectedId={resolvedParams.task}
            searchParams={resolvedParams}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-4)] text-sm text-[var(--color-text-muted)]">
              {page > 1 && (
                <a
                  href={`/collections?${new URLSearchParams({ ...resolvedParams, page: String(page - 1) }).toString()}`}
                  className="text-[var(--color-accent)] hover:underline"
                >
                  ← Previous
                </a>
              )}
              <span>
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <a
                  href={`/collections?${new URLSearchParams({ ...resolvedParams, page: String(page + 1) }).toString()}`}
                  className="text-[var(--color-accent)] hover:underline"
                >
                  Next →
                </a>
              )}
            </div>
          )}
        </div>

        {/* Side panel */}
        <Suspense>
          <TaskSidePanel
            task={
              selectedTask
                ? {
                    id: selectedTask.id,
                    status: selectedTask.status,
                    reason_code: selectedTask.reason_code,
                    priority_score: Number(selectedTask.priority_score),
                    due_date: selectedTask.due_date
                      ? selectedTask.due_date.toISOString()
                      : null,
                    dismissed_reason: selectedTask.dismissed_reason,
                    owner_user_id: selectedTask.owner_user_id,
                    created_at: selectedTask.created_at.toISOString(),
                    updated_at: selectedTask.updated_at.toISOString(),
                    canonical_id: selectedTask.canonical_id,
                    invoice_id: selectedTask.invoice_id,
                    entity_id: selectedTask.entity_id,
                  }
                : null
            }
          />
        </Suspense>
      </div>
    </div>
  );
}
