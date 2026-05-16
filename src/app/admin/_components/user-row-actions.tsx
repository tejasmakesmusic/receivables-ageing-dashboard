"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

type Role = "ANALYST" | "CFO" | "REVIEWER" | "ADMIN";

const APPROVE_ROLES: Role[] = ["ANALYST", "REVIEWER", "CFO", "ADMIN"];

export function UserRowActions({
  userId,
  role,
  isActive,
}: {
  userId: string;
  role: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [approveRole, setApproveRole] = useState<Role>("ANALYST");

  async function call(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.message ?? `Request failed (${res.status})`);
      }
      toast.success("Done.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (role === "PENDING") {
    return (
      <div className="flex items-center gap-2">
        <select
          aria-label="Approve role"
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
          disabled={busy}
          onChange={(e) => setApproveRole(e.target.value as Role)}
          value={approveRole}
        >
          {APPROVE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2.5 text-xs font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
          disabled={busy}
          onClick={() => call(`/api/admin/users/${userId}/approve`, { role: approveRole })}
          type="button"
        >
          Approve
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isActive ? (
        <button
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            if (!confirm("Deactivate this user? They will lose all access.")) return;
            void call(`/api/admin/users/${userId}/deactivate`);
          }}
          type="button"
        >
          Deactivate
        </button>
      ) : (
        <button
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
          disabled={busy}
          onClick={() => call(`/api/admin/users/${userId}/reactivate`)}
          type="button"
        >
          Reactivate
        </button>
      )}
    </div>
  );
}
