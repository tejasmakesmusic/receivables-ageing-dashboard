"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

type Bucket = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
};

export function ExceptionBucketsManager({ buckets }: { buckets: Bucket[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.message ?? `Request failed (${res.status})`);
      }
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      toast.error("Code and name are required.");
      return;
    }
    const ok = await call("/api/admin/exception-buckets", "POST", {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
    });
    if (ok) {
      toast.success(`Created bucket ${code.trim().toUpperCase()}.`);
      setCode("");
      setName("");
      setDescription("");
    }
  }

  async function toggleActive(bucket: Bucket) {
    const next = !bucket.active;
    if (!confirm(`${next ? "Activate" : "Deactivate"} bucket ${bucket.code}?`)) return;
    const ok = await call(
      `/api/admin/exception-buckets/${bucket.id}`,
      "PATCH",
      { active: next },
    );
    if (ok) toast.success(`Bucket ${bucket.code} ${next ? "activated" : "deactivated"}.`);
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        onSubmit={create}
      >
        <h3 className="text-sm font-semibold">Create bucket</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">
              Code (UPPER_SNAKE)
            </span>
            <input
              className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm font-mono uppercase"
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
              placeholder="DISPUTE"
              required
              value={code}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">
              Name
            </span>
            <input
              className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer dispute pending resolution"
              required
              value={name}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            Description (optional)
          </span>
          <input
            className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            value={description}
          />
        </label>
        <div className="flex justify-end">
          <button
            className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            Add bucket
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {buckets.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]"
                  colSpan={5}
                >
                  No exception buckets configured.
                </td>
              </tr>
            ) : (
              buckets.map((bucket) => (
                <tr key={bucket.id}>
                  <td className="px-4 py-3 font-mono text-xs">{bucket.code}</td>
                  <td className="px-4 py-3">{bucket.name}</td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                    {bucket.description ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        bucket.active
                          ? "text-[var(--color-success)] font-medium"
                          : "text-[var(--color-text-subtle)]"
                      }
                    >
                      {bucket.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
                      disabled={busy}
                      onClick={() => toggleActive(bucket)}
                      type="button"
                    >
                      {bucket.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
