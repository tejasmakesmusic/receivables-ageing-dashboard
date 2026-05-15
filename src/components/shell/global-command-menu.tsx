"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import {
  COMMAND_GROUPS,
  type ScoredCommandItem,
  type FilteredCommandGroup,
  filterCommandItemsGrouped,
  type CommandItem,
} from "@/components/shell/command-menu-data";

function CommandRow({
  active,
  hasScores,
  item,
  onSelect,
}: {
  active: boolean;
  hasScores: boolean;
  item: ScoredCommandItem;
  onSelect: () => void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={[
        "flex w-full items-center justify-between gap-4 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors",
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]",
      ].join(" ")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      type="button"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">
            {item.label}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
            {item.description}
          </span>
        </span>
        {hasScores ? (
          <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-subtle)]">
            {item.score}
          </span>
        ) : null}
        <ArrowRight className="h-4 w-4 shrink-0" />
      </button>
  );
}

export function GlobalCommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupedResults = useMemo(
    () => filterCommandItemsGrouped(query, COMMAND_GROUPS),
    [query],
  );
  const visibleGroups = useMemo(() => {
    const limitedGroups: FilteredCommandGroup[] = [];
    let remaining = 10;

    for (const group of groupedResults) {
      if (remaining <= 0) {
        break;
      }

      const items = group.items.slice(0, remaining);

      if (items.length === 0) {
        continue;
      }

      limitedGroups.push({
        id: group.id,
        label: group.label,
        items,
      });
      remaining -= items.length;
    }

    return limitedGroups;
  }, [groupedResults]);
  const flatResults = useMemo(
    () => visibleGroups.flatMap((group) => group.items),
    [visibleGroups],
  );
  const hasVisibleResults = flatResults.length > 0;
  const hasSearchScores = query.trim().length > 1;
  let renderIndex = 0;

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
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function updateQuery(value: string) {
    setQuery(value);
    setActiveIndex(0);
  }

  function selectItem(item: CommandItem, openInNewTab = false) {
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
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        flatResults.length > 0 ? (index + 1) % flatResults.length : 0,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        flatResults.length > 0 ? (index - 1 + flatResults.length) % flatResults.length : 0,
      );
      return;
    }

    if (event.key === "Enter" && flatResults[activeIndex]) {
      event.preventDefault();
      selectItem(
        flatResults[activeIndex],
        event.ctrlKey || event.metaKey,
      );
    }
  }

  return (
    <>
      <button
        className="flex h-10 w-full max-w-[520px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-subtle)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search workspaces, actions, records...</span>
        <kbd className="ml-auto hidden rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] sm:inline-flex">
          Ctrl K
        </kbd>
        <kbd className="ml-2 hidden rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] sm:inline-flex">
          /
        </kbd>
      </button>

      {open ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/20 px-4 py-[10vh] backdrop-blur-[2px]"
          onMouseDown={close}
          role="dialog"
        >
          <div
            className="mx-auto max-w-2xl overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
              <Search className="h-4 w-4 text-[var(--color-text-muted)]" />
              <input
                aria-label="Command search"
                className="h-14 min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-subtle)]"
                onChange={(event) => updateQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
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

            <div className="max-h-[52vh] overflow-y-auto p-2">
              {flatResults.length === 0 ? (
                <div className="grid min-h-32 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] p-6 text-center text-sm text-[var(--color-text-muted)]">
                  No matching command.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleGroups.map((group, groupIndex) => (
                    <div key={`${group.id}-${groupIndex}`} className="space-y-1">
                      <div className="px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                        {group.label}
                      </div>
                      <div className="space-y-1">
                        {group.items.map((item) => {
                          const rowIndex = renderIndex;
                          renderIndex += 1;
                          return (
                            <CommandRow
                              active={rowIndex === activeIndex}
                              hasScores={hasSearchScores}
                              item={item}
                              key={item.id}
                              onSelect={() => selectItem(item)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-text-subtle)]">
              <span>
                {hasVisibleResults
                  ? `Showing ${flatResults.length} command${flatResults.length === 1 ? "" : "s"}`
                  : "No matches"}
              </span>
              <span>
                <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]">
                  Up/Down
                </kbd>{" "}
                navigate,{" "}
                <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]">
                  Enter
                </kbd>{" "}
                open,{" "}
                <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px]">
                  Ctrl/Cmd + Enter
                </kbd>{" "}
                open new tab
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
