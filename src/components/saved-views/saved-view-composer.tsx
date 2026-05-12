"use client";

import { type FormEvent, useState } from "react";
import { Check, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/ui/side-panel";
import type { Surface, SavedViewVisibility } from "@/server/views/user-views";

type UserRole = "ANALYST" | "CFO" | "ADMIN" | "PENDING" | "REVIEWER";
type SearchParamsReader = {
  forEach(callbackfn: (value: string, key: string) => void): void;
};
type SaveViewResponse = { success: boolean; error: { message: string } | null };
type SavedViewComposerProps = {
  currentUserRole: UserRole;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  surface: Surface;
};

function searchParamsToObject(
  searchParams: SearchParamsReader,
): Record<string, string | string[]> {
  const filters: Record<string, string | string[]> = {};
  searchParams.forEach((value, key) => {
    const current = filters[key];
    if (current === undefined) {
      filters[key] = value;
    } else if (Array.isArray(current)) {
      filters[key] = [...current, value];
    } else {
      filters[key] = [current, value];
    }
  });

  return filters;
}

function visibilityClass(active: boolean, disabled = false) {
  return [
    "inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border px-3 text-sm font-medium transition-colors",
    active
      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]",
    disabled ? "cursor-not-allowed opacity-50" : "hover:bg-[var(--color-bg-muted)]",
  ].join(" ");
}

export function SavedViewComposer({
  currentUserRole,
  onOpenChange,
  onSaved,
  surface,
}: SavedViewComposerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<SavedViewVisibility>("PRIVATE");
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publicDisabled = currentUserRole !== "ADMIN";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a saved view name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          surface,
          name: trimmedName,
          visibility,
          filters: searchParamsToObject(searchParams),
          pinned,
        }),
      });
      const payload = (await response.json()) as SaveViewResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error?.message ?? "Saved view could not be created.",
        );
      }

      router.refresh();
      onSaved?.();
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Saved view could not be created.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4"
      onClick={() => {
        if (!saving) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-view-composer-title"
      >
        <SidePanel
          className="shadow-xl"
          title={<span id="saved-view-composer-title">Save current view</span>}
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                View name
              </span>
              <input
                className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]"
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>

            <div>
              <div className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">
                Visibility
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={visibilityClass(visibility === "PRIVATE")}
                  onClick={() => setVisibility("PRIVATE")}
                  type="button"
                >
                  Private
                </button>
                <button
                  className={visibilityClass(visibility === "PUBLIC", publicDisabled)}
                  disabled={publicDisabled}
                  onClick={() => setVisibility("PUBLIC")}
                  type="button"
                >
                  Public
                </button>
              </div>
              {publicDisabled ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Public views require an admin role.
                </p>
              ) : null}
            </div>

            <label className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 text-sm text-[var(--color-text)]">
              <input
                checked={pinned}
                className="h-4 w-4 accent-[var(--color-accent)]"
                onChange={(event) => setPinned(event.target.checked)}
                type="checkbox"
              />
              Pin this view
            </label>

            {error ? (
              <p className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                disabled={saving}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="secondary"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
              <Button disabled={saving || !name.trim()} type="submit">
                <Check className="h-4 w-4" />
                {saving ? "Saving..." : "Save view"}
              </Button>
            </div>
          </form>
        </SidePanel>
      </div>
    </div>
  );
}
