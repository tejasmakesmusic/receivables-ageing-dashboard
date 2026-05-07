import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";

interface Task {
  id: string;
  status: string;
  reason_code: string;
  priority_score: number | string;
  due_date: string | null;
  owner_user_id: string | null;
  canonical_id: string;
  invoice_id: string | null;
  created_at: string;
}

const REASON_LABEL: Record<string, string> = {
  NINETY_PLUS: "90+ days",
  HIGH_VALUE: "High value",
  STALE_FOLLOW_UP: "Stale contact",
  DISPUTE_OPEN: "Open dispute",
  BROKEN_PROMISE: "Broken PTP",
  MANUAL: "Manual",
};

function reasonLabel(reasonCode: string) {
  return REASON_LABEL[reasonCode] ?? reasonCode.replace(/_/g, " ");
}

function taskStatusTag(status: string) {
  return `TASK_${status}`;
}

function taskSignalTag(task: Task) {
  if (task.reason_code === "NINETY_PLUS") return { status: "90_PLUS" };
  if (task.reason_code === "BROKEN_PROMISE") return { status: "PTP_BROKEN" };
  if (task.reason_code === "DISPUTE_OPEN") return { status: "DISPUTE_OPEN" };
  if (task.reason_code === "STALE_FOLLOW_UP") {
    return { status: "FOLLOW_UP_DUE" };
  }
  if (task.reason_code === "HIGH_VALUE") {
    return { label: "High Value", status: "61_90" };
  }
  return { label: "Manual", status: "NO_DATA" };
}

function formatTaskDueDate(task: Task): string {
  if (!task.due_date) {
    return "No due date";
  }

  const date = new Date(task.due_date).toLocaleDateString();
  return task.status === "SNOOZED" ? `Snoozed until ${date}` : date;
}

function formatOwner(ownerUserId: string | null) {
  return ownerUserId ? `${ownerUserId.slice(0, 8)}...` : "Unassigned";
}

function taskHref(taskId: string, searchParams: Record<string, string>) {
  const params = new URLSearchParams(searchParams);
  params.set("task", taskId);
  return `/tasks?${params.toString()}`;
}

function hasActiveFilters(searchParams: Record<string, string>) {
  return Object.entries(searchParams).some(
    ([key, value]) => !["page", "tab", "task"].includes(key) && Boolean(value),
  );
}

function taskColumns(): DataTableColumn<Task>[] {
  return [
    {
      key: "task",
      header: "Task",
      sticky: "left",
      width: "min-w-[220px]",
      cell: (task) => (
        <div>
          <div className="font-medium text-[var(--color-text)]">
            {reasonLabel(task.reason_code)}
          </div>
          <div className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            Task {task.id.slice(0, 8)}
            {task.invoice_id ? ` | Invoice ${task.invoice_id.slice(0, 8)}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "party",
      header: "Party",
      sticky: "left",
      width: "min-w-[160px]",
      cell: (task) => (
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {task.canonical_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "ageing_signal",
      header: "Ageing / Signal",
      cell: (task) => {
        const signal = taskSignalTag(task);
        return <StatusTag label={signal.label} status={signal.status} />;
      },
    },
    {
      key: "priority",
      header: "Priority",
      align: "right",
      className: "font-semibold tabular-nums",
      cell: (task) => Number(task.priority_score).toFixed(0),
    },
    {
      key: "owner",
      header: "Assigned User",
      cell: (task) => (
        <span className="text-[var(--color-text-muted)]">
          {formatOwner(task.owner_user_id)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (task) => <StatusTag status={taskStatusTag(task.status)} />,
    },
    {
      key: "reason_code",
      header: "Reason Code",
      cell: (task) => (
        <span className="text-[var(--color-text-muted)]">
          {reasonLabel(task.reason_code)}
        </span>
      ),
    },
    {
      key: "due",
      header: "Snooze / Due",
      cell: (task) => (
        <span className="text-[var(--color-text-muted)]">
          {formatTaskDueDate(task)}
        </span>
      ),
    },
  ];
}

export function TaskTable({
  tasks,
  selectedId,
  searchParams,
}: {
  tasks: Task[];
  selectedId?: string;
  searchParams: Record<string, string>;
}) {
  return (
    <DataTable<Task>
      columns={taskColumns()}
      emptyState={{
        title: "No tasks yet",
        description:
          "Collection tasks appear here after a snapshot creates follow-up, promise, dispute, or ageing work.",
        action: (
          <Link
            className="text-sm font-medium text-[var(--color-accent)]"
            href="/snapshots"
          >
            Upload snapshot
          </Link>
        ),
      }}
      filteredEmptyState={{
        title: "No tasks match these filters",
        description: "Try clearing filters or switching to another saved view.",
        action: (
          <Link
            className="text-sm font-medium text-[var(--color-accent)]"
            href="/tasks"
          >
            Clear filters
          </Link>
        ),
      }}
      isFiltered={hasActiveFilters(searchParams)}
      minWidthClass="min-w-[1080px]"
      rowHref={(task) => taskHref(task.id, searchParams)}
      rowKey={(task) => task.id}
      rows={tasks}
      selectedRowKey={selectedId ?? null}
    />
  );
}
