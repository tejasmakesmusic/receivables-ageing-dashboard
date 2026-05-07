import Link from "next/link";
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

function formatTaskDueDate(task: Task): string {
  if (!task.due_date) {
    return "No due date";
  }

  const date = new Date(task.due_date).toLocaleDateString();
  return task.status === "SNOOZED" ? `Snoozed until ${date}` : date;
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
  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-[var(--color-text-subtle)]">
        No tasks match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left">
            <th className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-medium text-[var(--color-text-subtle)]">
              Reason
            </th>
            <th className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-medium text-[var(--color-text-subtle)]">
              Party
            </th>
            <th className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-medium text-[var(--color-text-subtle)]">
              Status
            </th>
            <th className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-medium text-[var(--color-text-subtle)]">
              Priority
            </th>
            <th className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-medium text-[var(--color-text-subtle)]">
              Due date
            </th>
            <th className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-medium text-[var(--color-text-subtle)]">
              Owner
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const params = new URLSearchParams(searchParams);
            params.set("task", task.id);
            const isSelected = task.id === selectedId;

            return (
              <tr
                key={task.id}
                className={[
                  "border-b border-[var(--color-border)] transition-colors",
                  isSelected
                    ? "bg-[var(--color-accent-soft)]"
                    : "hover:bg-[var(--color-bg-subtle)]",
                ].join(" ")}
              >
                <td className="px-[var(--spacing-4)] py-[var(--spacing-3)]">
                  <Link
                    href={`/tasks?${params.toString()}`}
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    {REASON_LABEL[task.reason_code] ?? task.reason_code}
                  </Link>
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] font-mono text-xs text-[var(--color-text-muted)]">
                  {task.canonical_id.slice(0, 8)}…
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-3)]">
                  <StatusTag status={`TASK_${task.status}`} />
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-[var(--color-text)]">
                  {Number(task.priority_score).toFixed(0)}
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-[var(--color-text-muted)]">
                  {formatTaskDueDate(task)}
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-[var(--color-text-muted)]">
                  {task.owner_user_id
                    ? task.owner_user_id.slice(0, 8) + "…"
                    : "Unassigned"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
