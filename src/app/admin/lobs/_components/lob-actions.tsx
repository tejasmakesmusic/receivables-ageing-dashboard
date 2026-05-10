"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Status = "idle" | "submitting" | "error" | "success";

/**
 * PR 9 — Create-LOB form. Posts to /api/admin/lobs and refreshes the page.
 */
export function CreateLobForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body = {
      entity_code: String(form.get("entity_code")),
      code: String(form.get("code") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || undefined,
    };
    try {
      const response = await fetch("/api/admin/lobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(
          payload?.message ?? `Create failed with ${response.status}`,
        );
      }
      setStatus("success");
      setMessage("LOB created.");
      (event.target as HTMLFormElement).reset();
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <form
      className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:grid-cols-2"
      onSubmit={handleSubmit}
    >
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Entity</span>
        <select
          className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
          disabled={status === "submitting" || isPending}
          name="entity_code"
          required
        >
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Code</span>
        <input
          className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
          disabled={status === "submitting" || isPending}
          maxLength={64}
          name="code"
          pattern="[A-Za-z0-9_-]+"
          placeholder="e.g. SAAS, AUTOMOTIVE"
          required
          title="Letters, digits, _ or -"
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        <span className="font-medium">Name</span>
        <input
          className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
          disabled={status === "submitting" || isPending}
          maxLength={255}
          name="name"
          placeholder="Display name"
          required
        />
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        <span className="font-medium">Description (optional)</span>
        <textarea
          className="min-h-[60px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          disabled={status === "submitting" || isPending}
          maxLength={2000}
          name="description"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-60"
          disabled={status === "submitting" || isPending}
          type="submit"
        >
          {status === "submitting" ? "Creating…" : "Create LOB"}
        </button>
        {message ? (
          <span
            aria-live="polite"
            className={
              status === "error"
                ? "text-sm text-[var(--color-status-danger-text)]"
                : "text-sm text-[var(--color-status-current-text)]"
            }
          >
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function ToggleLobActiveButton({
  lobId,
  active,
}: {
  lobId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/lobs/${lobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(
          payload?.message ?? `Update failed with ${response.status}`,
        );
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className={
          active
            ? "inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-3 text-xs font-medium text-[var(--color-status-warning-text)] hover:opacity-80 disabled:pointer-events-none disabled:opacity-60"
            : "inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] disabled:pointer-events-none disabled:opacity-60"
        }
        disabled={pending}
        onClick={toggle}
        type="button"
      >
        {pending ? "…" : active ? "Deactivate" : "Reactivate"}
      </button>
      {error ? (
        <span
          aria-live="polite"
          className="text-xs text-[var(--color-status-danger-text)]"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
