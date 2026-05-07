"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import {
  COMMAND_GROUPS,
  filterCommandItems,
  type CommandItem,
} from "@/components/shell/command-menu-data";

function CommandRow({
  active,
  item,
  onSelect,
}: {
  active: boolean;
  item: CommandItem;
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
  const results = useMemo(
    () => filterCommandItems(query, COMMAND_GROUPS).slice(0, 10),
    [query],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
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

  function selectItem(item: CommandItem) {
    close();
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
        results.length > 0 ? (index + 1) % results.length : 0,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length > 0 ? (index - 1 + results.length) % results.length : 0,
      );
      return;
    }

    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      selectItem(results[activeIndex]);
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
        <kbd className="ml-auto hidden rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-subtle)] sm:inline-flex">
          Ctrl K
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
              {results.length === 0 ? (
                <div className="grid min-h-32 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-bg-subtle)] p-6 text-center text-sm text-[var(--color-text-muted)]">
                  No matching command.
                </div>
              ) : (
                <div className="space-y-1">
                  {results.map((item, index) => (
                    <CommandRow
                      active={index === activeIndex}
                      item={item}
                      key={item.id}
                      onSelect={() => selectItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
