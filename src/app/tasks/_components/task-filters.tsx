"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";
import type { collection_task_status } from "@/generated/prisma/enums";

const STATUS_OPTIONS: { value: collection_task_status | ""; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "SUGGESTED", label: "Suggested" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "SNOOZED", label: "Snoozed" },
  { value: "DONE", label: "Done" },
  { value: "DISMISSED", label: "Dismissed" },
];

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All reasons" },
  { value: "NINETY_PLUS", label: "90+ days" },
  { value: "HIGH_VALUE", label: "High value" },
  { value: "STALE_FOLLOW_UP", label: "Stale contact" },
  { value: "DISPUTE_OPEN", label: "Open dispute" },
  { value: "BROKEN_PROMISE", label: "Broken PTP" },
  { value: "MANUAL", label: "Manual" },
];

export function TaskFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("system_view");
      params.delete("page"); // reset pagination on filter change
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap gap-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-3)] border-b border-[var(--color-border)]">
      <select
        value={searchParams.get("status") ?? ""}
        onChange={(e) => update("status", e.target.value)}
        className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--spacing-2)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        value={searchParams.get("reason_code") ?? ""}
        onChange={(e) => update("reason_code", e.target.value)}
        className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[var(--spacing-2)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
      >
        {REASON_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-[var(--spacing-2)] text-sm text-[var(--color-text-muted)]">
        <input
          type="checkbox"
          checked={searchParams.get("mine") === "1"}
          onChange={(e) => update("mine", e.target.checked ? "1" : "")}
          className="rounded"
        />
        My tasks only
      </label>
    </div>
  );
}
