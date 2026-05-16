"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EntityDefaultRow } from "@/server/config/entityDefaults";

type Props = {
  entities: EntityDefaultRow[];
  canEdit: boolean;
};

type RowState =
  | { mode: "view" }
  | { mode: "editing"; draft: string }
  | { mode: "saving" }
  | { mode: "error"; draft: string; message: string };

export function EntityDefaultsCard({ entities, canEdit }: Props) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(
    () => Object.fromEntries(entities.map((e) => [e.id, { mode: "view" }])),
  );
  const [localDefaults, setLocalDefaults] = useState<
    Record<string, number | null>
  >(() =>
    Object.fromEntries(entities.map((e) => [e.id, e.default_credit_days])),
  );

  function startEdit(id: string) {
    const current = localDefaults[id];
    setRowStates((s) => ({
      ...s,
      [id]: { mode: "editing", draft: current === null ? "" : String(current) },
    }));
  }

  function cancelEdit(id: string) {
    setRowStates((s) => ({ ...s, [id]: { mode: "view" } }));
  }

  async function save(id: string) {
    const captured = { draft: null as string | null };
    setRowStates((s) => {
      const state = s[id];
      if (state.mode !== "editing") return s;
      captured.draft = state.draft;
      return { ...s, [id]: { mode: "saving" } };
    });
    if (captured.draft === null) return;

    const trimmed = captured.draft.trim();
    const newValue = trimmed === "" ? null : Number(trimmed);

    if (newValue !== null && (!Number.isInteger(newValue) || newValue < 0)) {
      setRowStates((s) => ({
        ...s,
        [id]: { mode: "error", draft: trimmed, message: "Must be a non-negative whole number" },
      }));
      return;
    }

    try {
      const res = await fetch(`/api/config/entity-defaults/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_credit_days: newValue }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? `Request failed with ${res.status}`);
      }
      setLocalDefaults((d) => ({ ...d, [id]: newValue }));
      setRowStates((s) => ({ ...s, [id]: { mode: "view" } }));
    } catch (err) {
      setRowStates((s) => ({
        ...s,
        [id]: {
          mode: "error",
          draft: trimmed,
          message: err instanceof Error ? err.message : "Save failed",
        },
      }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entity Default Credit Days</CardTitle>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Use this fallback only when an entity has a standard approved credit
          period. Party-level credit period config still wins. Existing invoices are
          not backfilled.
        </p>
      </CardHeader>
      <CardContent>
        <table className="w-full table-auto text-sm">
          <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Default Credit Days</th>
              {canEdit ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {entities.map((entity) => {
              const state = rowStates[entity.id] ?? { mode: "view" };
              const currentDefault = localDefaults[entity.id];

              return (
                <tr key={entity.id}>
                  <td className="px-3 py-2 font-medium">{entity.code}</td>
                  <td className="px-3 py-2">
                    {state.mode === "editing" || state.mode === "error" ? (
                      <div className="flex flex-col gap-1">
                        <input
                          autoFocus
                          className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                          min={0}
                          onChange={(e) =>
                            setRowStates((s) => ({
                              ...s,
                              [entity.id]: {
                                mode: "editing",
                                draft: e.target.value,
                              },
                            }))
                          }
                          placeholder="e.g. 30"
                          type="number"
                          value={
                            state.mode === "editing" || state.mode === "error" ? state.draft : ""
                          }
                        />
                        {state.mode === "error" ? (
                          <p className="text-xs text-[var(--color-status-danger-text)]">
                            {state.message}
                          </p>
                        ) : null}
                      </div>
                    ) : state.mode === "saving" ? (
                      <span className="text-[var(--color-text-muted)]">
                        Saving…
                      </span>
                    ) : currentDefault === null ? (
                      <span className="text-[var(--color-text-muted)]">
                        No fallback set
                      </span>
                    ) : (
                      <span className="tabular-nums">{currentDefault} days</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      {state.mode === "view" ? (
                        <button
                          className="text-xs text-[var(--color-accent)] hover:underline"
                          onClick={() => startEdit(entity.id)}
                          type="button"
                        >
                          Edit
                        </button>
                      ) : state.mode === "editing" ||
                        state.mode === "error" ? (
                        <div className="flex gap-2">
                          <button
                            className="text-xs text-[var(--color-accent)] hover:underline"
                            onClick={() => save(entity.id)}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="text-xs text-[var(--color-text-muted)] hover:underline"
                            onClick={() => cancelEdit(entity.id)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
