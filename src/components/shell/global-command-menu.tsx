"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { ArrowRight, Search, X } from "lucide-react";
import {
  COMMAND_GROUPS,
  type FilteredCommandGroup,
  filterCommandItemsGrouped,
  flattenCommandItems,
  type CommandItem,
} from "@/components/shell/command-menu-data";

const RECENT_COMMANDS_KEY = "receivables.command-menu.recent.v1";
const RECENT_COMMANDS_MAX = 5;

function safeJsonList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function readRecentCommandIds() {
  if (typeof window === "undefined") return [];
  return safeJsonList(window.localStorage.getItem(RECENT_COMMANDS_KEY)).slice(
    0,
    RECENT_COMMANDS_MAX,
  );
}

function writeRecentCommand(item: CommandItem) {
  const next = [
    item.id,
    ...readRecentCommandIds().filter((id) => id !== item.id),
  ].slice(0, RECENT_COMMANDS_MAX);
  window.localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
}

function CommandRow({ item, onSelect }: { item: CommandItem; onSelect: () => void }) {
  return (
    <Command.Item
      className="group flex cursor-default items-center justify-between gap-4 rounded-[var(--radius-sm)] px-3 py-2 text-left text-[13px] text-[var(--color-text)] outline-none aria-selected:bg-[var(--color-accent-soft)] aria-selected:text-[var(--color-accent)]"
      keywords={[...item.keywords]}
      onSelect={onSelect}
      value={`${item.label} ${item.href} ${item.description}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{item.label}</span>
        <span className="mt-0.5 block truncate text-[12px] text-[var(--color-text-muted)]">
          {item.description}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-subtle)] group-aria-selected:text-[var(--color-accent)]" />
    </Command.Item>
  );
}

export function GlobalCommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>(() =>
    readRecentCommandIds(),
  );
  const allCommands = useMemo(() => flattenCommandItems(COMMAND_GROUPS), []);
  const recentCommands = useMemo(() => {
    const byId = new Map(allCommands.map((item) => [item.id, item] as const));
    return recentCommandIds
      .map((id) => byId.get(id))
      .filter((item): item is CommandItem => Boolean(item));
  }, [allCommands, recentCommandIds]);
  const groupedResults = useMemo(
    () => filterCommandItemsGrouped(query, COMMAND_GROUPS),
    [query],
  );
  const visibleGroups: FilteredCommandGroup[] = useMemo(() => {
    const limitedGroups: FilteredCommandGroup[] = [];
    let remaining = 12;

    for (const group of groupedResults) {
      if (remaining <= 0) break;
      const items = group.items.slice(0, remaining);
      if (items.length === 0) continue;
      limitedGroups.push({ id: group.id, label: group.label, items });
      remaining -= items.length;
    }

    return limitedGroups;
  }, [groupedResults]);
  const resultCount = visibleGroups.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        return;
      }

      if (event.key === "/") {
        const target = event.target as HTMLElement | null;
        const targetTag = target?.tagName?.toLowerCase();
        const isEditable =
          targetTag === "input" ||
          targetTag === "textarea" ||
          targetTag === "select" ||
          target?.isContentEditable;

        if (!isEditable) {
          event.preventDefault();
          setOpen(true);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function selectItem(item: CommandItem, openInNewTab = false) {
    writeRecentCommand(item);
    setRecentCommandIds(readRecentCommandIds());
    close();

    if (openInNewTab) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }

    if (item.href.startsWith("/api/")) {
      window.location.href = item.href;
      return;
    }

    router.push(item.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      const first = visibleGroups[0]?.items[0];
      if (first) {
        event.preventDefault();
        selectItem(first, true);
      }
    }
  }

  return (
    <>
      <button
        className="flex h-8 w-full max-w-[520px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[13px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-subtle)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search or run command</span>
        <kbd className="ml-auto hidden rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] sm:inline-flex">
          Cmd K
        </kbd>
        <kbd className="ml-1 hidden rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] sm:inline-flex">
          /
        </kbd>
      </button>

      <Command.Dialog
        className="fixed inset-0 z-50 bg-black/20 px-4 py-[10vh] backdrop-blur-[2px]"
        label="Command menu"
        onOpenChange={setOpen}
        open={open}
        shouldFilter={false}
      >
        <div
          className="mx-auto max-w-2xl overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
            <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
            <Command.Input
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
              onKeyDown={onInputKeyDown}
              onValueChange={setQuery}
              placeholder="Type a workspace, action, or record"
              ref={inputRef}
              value={query}
            />
            <button
              aria-label="Close command menu"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]"
              onClick={close}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <Command.List className="max-h-[52vh] overflow-y-auto p-2">
            {query.trim().length === 0 && recentCommands.length > 0 ? (
              <Command.Group
                className="space-y-1 pb-2"
                heading={
                  <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    Recent
                  </div>
                }
              >
                {recentCommands.map((item) => (
                  <CommandRow
                    item={item}
                    key={`recent-${item.id}`}
                    onSelect={() => selectItem(item)}
                  />
                ))}
              </Command.Group>
            ) : null}

            {resultCount === 0 ? (
              <Command.Empty className="grid min-h-32 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] p-6 text-center text-[13px] text-[var(--color-text-muted)]">
                No matching command.
              </Command.Empty>
            ) : (
              visibleGroups.map((group) => (
                <Command.Group
                  className="space-y-1 pb-2"
                  heading={
                    <div className="px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                      {group.label}
                    </div>
                  }
                  key={group.id}
                >
                  {group.items.map((item) => (
                    <CommandRow
                      item={item}
                      key={item.id}
                      onSelect={() => selectItem(item)}
                    />
                  ))}
                </Command.Group>
              ))
            )}
          </Command.List>

          <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-text-subtle)]">
            <span>{resultCount} command{resultCount === 1 ? "" : "s"}</span>
            <span>
              <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]">
                Up/Down
              </kbd>{" "}
              navigate, {" "}
              <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]">
                Enter
              </kbd>{" "}
              open
            </span>
          </div>
        </div>
      </Command.Dialog>
    </>
  );
}
