"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

type Alias = {
  id: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: "IND" | "UAE";
  alias_text: string;
  source: string;
  created_at: string;
};

type Props = {
  aliases: Alias[];
  canEdit: boolean;
};

export function AliasesManager({ aliases, canEdit }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<"ALL" | "IND" | "UAE">("ALL");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return aliases.filter((a) => {
      if (entityFilter !== "ALL" && a.entity_code !== entityFilter) return false;
      if (!term) return true;
      return (
        a.alias_text.toLowerCase().includes(term) ||
        a.canonical_name.toLowerCase().includes(term)
      );
    });
  }, [aliases, search, entityFilter]);

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

  async function saveEdit(alias: Alias) {
    if (!editText.trim() || editText.trim() === alias.alias_text) {
      setEditing(null);
      return;
    }
    const ok = await call(
      `/api/config/aliases/${alias.id}`,
      "PATCH",
      { alias_text: editText.trim() },
    );
    if (ok) {
      toast.success("Alias updated.");
      setEditing(null);
    }
  }

  async function remove(alias: Alias) {
    if (
      !confirm(
        `Delete alias "${alias.alias_text}" → ${alias.canonical_name}? Future imports of this name will need to be re-mapped.`,
      )
    )
      return;
    const ok = await call(`/api/config/aliases/${alias.id}`, "DELETE");
    if (ok) toast.success("Alias deleted.");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-64 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search alias or canonical name…"
          type="text"
          value={search}
        />
        <select
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          onChange={(e) =>
            setEntityFilter(e.target.value as "ALL" | "IND" | "UAE")
          }
          value={entityFilter}
        >
          <option value="ALL">All entities</option>
          <option value="IND">IND</option>
          <option value="UAE">UAE</option>
        </select>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">
          {filtered.length} of {aliases.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2">Alias text</th>
              <th className="px-3 py-2">Canonical party</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Source</th>
              {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {filtered.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
                  colSpan={canEdit ? 5 : 4}
                >
                  No aliases match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((alias) => (
                <tr key={alias.id}>
                  <td className="px-3 py-2 font-mono text-xs">
                    {editing === alias.id ? (
                      <input
                        autoFocus
                        className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
                        disabled={busy}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit(alias);
                          else if (e.key === "Escape") setEditing(null);
                        }}
                        value={editText}
                      />
                    ) : (
                      alias.alias_text
                    )}
                  </td>
                  <td className="px-3 py-2">{alias.canonical_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {alias.entity_code}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--color-text-muted)]">
                    {alias.source}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        {editing === alias.id ? (
                          <>
                            <button
                              className="inline-flex h-7 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 text-xs font-medium text-white disabled:opacity-50"
                              disabled={busy}
                              onClick={() => saveEdit(alias)}
                              type="button"
                            >
                              Save
                            </button>
                            <button
                              className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
                              onClick={() => setEditing(null)}
                              type="button"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs hover:bg-[var(--color-bg-muted)] disabled:opacity-50"
                              disabled={busy}
                              onClick={() => {
                                setEditing(alias.id);
                                setEditText(alias.alias_text);
                              }}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="inline-flex h-7 items-center rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-2 text-xs text-[var(--color-status-danger-text)] hover:opacity-80 disabled:opacity-50"
                              disabled={busy}
                              onClick={() => remove(alias)}
                              type="button"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
