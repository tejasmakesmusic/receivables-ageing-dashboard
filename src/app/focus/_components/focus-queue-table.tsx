"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, GitBranch, Hand, MessageSquarePlus } from "lucide-react";
import { useRef, useState } from "react";
import {
  getKeyboardCommand,
  isEditableKeyboardTarget,
} from "@/components/interaction/keyboard-command-presets";
import { getNextRovingIndex } from "@/components/interaction/roving-focus";
import {
  TABLE_ROW_INTERACTIVE_CLASS,
  TABLE_ROW_SELECTED_CLASS,
} from "@/components/ui/table-row-styles";
import { TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import type { FocusQueueItem } from "@/server/focus/service";

type FocusQueueTableProps = {
  items: FocusQueueItem[];
};

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

function actionHint(item: FocusQueueItem) {
  if (item.type === "TASK") {
    return {
      icon: Hand,
      label: item.status === "TASK_SUGGESTED" ? "Claim" : "Work",
      title: "Open task action panel",
    };
  }

  if (item.type === "PTP") {
    return {
      icon: MessageSquarePlus,
      label: "Promise",
      title: "Review promise follow-up",
    };
  }

  if (item.type === "DISPUTE") {
    return {
      icon: GitBranch,
      label: "Escalate",
      title: "Review dispute path",
    };
  }

  if (item.type === "STAGING_BLOCKER") {
    return {
      icon: GitBranch,
      label: "Resolve",
      title: "Open staging blockers",
    };
  }

  return {
    icon: GitBranch,
    label: "Tie-out",
    title: "Open reconciliation context",
  };
}

export function FocusQueueTable({ items }: FocusQueueTableProps) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  function focusRow(index: number) {
    setActiveIndex(index);
    rowRefs.current[index]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableSectionElement>) {
    if (isEditableKeyboardTarget(event.target)) {
      return;
    }

    const command = getKeyboardCommand(event.key);
    if (!command) {
      return;
    }

    if (command === "MOVE_NEXT" || command === "MOVE_PREVIOUS") {
      event.preventDefault();
      const nextIndex = getNextRovingIndex({
        currentIndex: activeIndex,
        itemCount: items.length,
        key: event.key,
      });
      if (nextIndex >= 0) {
        focusRow(nextIndex);
      }
      return;
    }

    if (command === "OPEN" && items[activeIndex]) {
      event.preventDefault();
      router.push(items[activeIndex].href);
      return;
    }

    if (command === "CANCEL") {
      event.preventDefault();
      rowRefs.current[activeIndex]?.blur();
    }
  }

  return (
    <TableShell className="rounded-none border-x-0 border-b-0">
    <table className="w-full min-w-[980px] text-sm">
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
          <th className="w-36 px-[var(--spacing-4)] py-[var(--spacing-2)] text-right text-xs font-medium text-[var(--color-text-muted)]">
            Next action
          </th>
        </tr>
      </thead>
      <tbody
        className="divide-y divide-[var(--color-border)]"
        onKeyDown={handleKeyDown}
      >
        {items.map((item, index) => {
          const hint = actionHint(item);
          const HintIcon = hint.icon;

          return (
            <tr
              aria-selected={index === activeIndex ? "true" : undefined}
              className={[
                "group",
                TABLE_ROW_INTERACTIVE_CLASS,
                "outline-none focus-visible:bg-[var(--color-accent-soft)]",
                index === activeIndex ? TABLE_ROW_SELECTED_CLASS : "",
              ].join(" ")}
              key={`${item.type}-${item.id}`}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button")) return;
                router.push(item.href);
              }}
              onFocus={() => setActiveIndex(index)}
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              tabIndex={index === activeIndex ? 0 : -1}
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
              <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-right font-mono text-xs tabular-nums text-[var(--color-text)]">
                {item.priority_score.toFixed(0)}
              </td>
              <td className="px-[var(--spacing-4)] py-[var(--spacing-3)] text-right">
                <div className="flex justify-end gap-1">
                  <Link
                    aria-label={hint.title}
                    className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)]"
                    data-focus-queue-action={hint.label.toLowerCase()}
                    href={item.href}
                    title={hint.title}
                  >
                    <HintIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {hint.label}
                  </Link>
                  <Link
                    aria-label={`Open ${item.title}`}
                    className="inline-grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-muted)] transition-[border-color,color] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)]"
                    data-focus-queue-action="open-context"
                    href={item.href}
                    title="Open context"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </TableShell>
  );
}
