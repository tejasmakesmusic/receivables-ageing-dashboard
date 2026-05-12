"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SavedView, Surface } from "@/server/views/user-views";
import { SavedViewComposer } from "@/components/saved-views/saved-view-composer";

type UserRole = "ANALYST" | "CFO" | "ADMIN" | "PENDING" | "REVIEWER";
type ClientSavedView = Omit<SavedView, "created_at" | "updated_at"> & {
  created_at: string;
  updated_at: string;
};
type ViewsResponse = { success: boolean; data: ClientSavedView[] | null; error: { message: string } | null };
type SearchParamsReader = { forEach(callbackfn: (value: string, key: string) => void): void };
type SavedViewSwitcherProps = { currentUserRole: UserRole; surface: Surface };

const INVOICE_VIEWS_ENDPOINT = "/api/views?surface=invoices";
const SURFACE_PATHS: Record<Surface, string> = {
  invoices: "/invoices",
  tasks: "/tasks",
  parties: "/parties",
  promises_to_pay: "/promises-to-pay",
  dispute_cases: "/dispute-cases",
  snapshots: "/snapshots",
};

function endpointForSurface(surface: Surface) {
  if (surface === "invoices") return INVOICE_VIEWS_ENDPOINT;
  return `/api/views?surface=${encodeURIComponent(surface)}`;
}

function normalizeFilterValue(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(normalizeFilterValue);

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [String(value)];
  }

  return [JSON.stringify(value)];
}

function entriesFromFilters(filters: Record<string, unknown>): string[] {
  return Object.entries(filters)
    .flatMap(([key, value]) =>
      normalizeFilterValue(value).map((normalized) => `${key}=${normalized}`),
    )
    .sort();
}

function entriesFromSearchParams(searchParams: SearchParamsReader): string[] {
  const entries: string[] = [];
  searchParams.forEach((value, key) => {
    if (value) entries.push(`${key}=${value}`);
  });
  return entries.sort();
}

function appendFilter(params: URLSearchParams, key: string, value: unknown) {
  for (const normalized of normalizeFilterValue(value)) {
    params.append(key, normalized);
  }
}

function hrefForFilters(basePath: string, filters: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    appendFilter(params, key, value);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function pillClass(active: boolean) {
  return [
    "inline-flex h-9 max-w-[220px] items-center gap-1.5 truncate rounded-[var(--radius-sm)] border px-3 text-sm transition-colors",
    active
      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
      : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
  ].join(" ");
}

export function SavedViewSwitcher({
  currentUserRole,
  surface,
}: SavedViewSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [views, setViews] = useState<ClientSavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const endpoint = endpointForSurface(surface);
  const basePath = SURFACE_PATHS[surface];
  const currentEntries = entriesFromSearchParams(searchParams);

  const loadViews = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(endpoint, {
          headers: { Accept: "application/json" },
          signal,
        });
        const payload = (await response.json()) as ViewsResponse;

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(
            payload.error?.message ?? "Saved views could not be loaded.",
          );
        }
        setViews(payload.data);
        setError(null);
      } catch (caught) {
        if (signal?.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Saved views could not be loaded.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void loadViews(controller.signal);
    });
    return () => controller.abort();
  }, [loadViews]);

  const sortedViews = useMemo(
    () =>
      [...views].sort(
        (left, right) =>
          Number(right.pinned) - Number(left.pinned) ||
          left.name.localeCompare(right.name, undefined, {
            sensitivity: "base",
          }),
      ),
    [views],
  );

  if (loading && views.length === 0) {
    return <div className="h-10 animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)]" />;
  }

  return (
    <>
      <nav
        aria-label="Saved invoice views"
        className="flex min-h-10 flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-2"
      >
        <button
          aria-pressed={currentEntries.length === 0}
          className={pillClass(currentEntries.length === 0)}
          onClick={() => router.push(basePath)}
          type="button"
        >
          All invoices
        </button>

        {sortedViews.map((view) => {
          const active = arraysEqual(
            entriesFromFilters(view.filters),
            currentEntries,
          );

          return (
            <button
              aria-pressed={active}
              className={pillClass(active)}
              key={view.view_id}
              onClick={() => router.push(hrefForFilters(basePath, view.filters))}
              title={view.name}
              type="button"
            >
              {view.visibility === "PRIVATE" ? (
                <Lock aria-label="Private view" className="h-3.5 w-3.5" />
              ) : null}
              <span className="truncate">{view.name}</span>
            </button>
          );
        })}

        {error ? (
          <span className="text-xs text-[var(--color-danger)]">{error}</span>
        ) : null}

        <button
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
          onClick={() => setComposerOpen(true)}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Save view
        </button>
      </nav>

      {composerOpen ? (
        <SavedViewComposer
          currentUserRole={currentUserRole}
          onOpenChange={setComposerOpen}
          onSaved={() => {
            setLoading(true);
            void loadViews();
          }}
          surface={surface}
        />
      ) : null}
    </>
  );
}
