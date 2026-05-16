"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PartyCreditPeriodSummary } from "@/server/config/creditPeriod";

type Props = {
  parties: PartyCreditPeriodSummary[];
  canEdit: boolean;
};

type SortKey = "name" | "entity" | "days" | "source";

export function PartiesCreditPeriodTable({ parties, canEdit }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState<"ALL" | "IND" | "UAE">("ALL");
  const [sourceFilter, setSourceFilter] = useState<
    "ALL" | "party" | "entity_default" | "none"
  >("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDays, setModalDays] = useState("");
  const [modalDate, setModalDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [modalNote, setModalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [resultMsg, setResultMsg] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = parties.filter((p) => {
      if (entityFilter !== "ALL" && p.entity_code !== entityFilter) return false;
      if (sourceFilter !== "ALL" && p.source !== sourceFilter) return false;
      if (term && !p.canonical_name.toLowerCase().includes(term)) return false;
      return true;
    });
    const sorted = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.canonical_name.localeCompare(b.canonical_name);
      else if (sortKey === "entity") cmp = a.entity_code.localeCompare(b.entity_code);
      else if (sortKey === "days") {
        const av = a.credit_days ?? -1;
        const bv = b.credit_days ?? -1;
        cmp = av - bv;
      } else if (sortKey === "source") cmp = a.source.localeCompare(b.source);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [parties, search, entityFilter, sourceFilter, sortKey, sortDir]);

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.canonical_id));
  const someVisibleSelected =
    filtered.some((p) => selected.has(p.canonical_id)) && !allVisibleSelected;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of filtered) next.delete(p.canonical_id);
      } else {
        for (const p of filtered) next.add(p.canonical_id);
      }
      return next;
    });
  }

  function changeSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openBulkModal() {
    setModalDays("");
    setModalDate(new Date().toISOString().slice(0, 10));
    setModalNote("");
    setError("");
    setResultMsg("");
    setModalOpen(true);
  }

  async function submitBulk(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const days = parseInt(modalDays, 10);
    if (!modalDays || Number.isNaN(days) || days < 0) {
      setError("Enter a valid non-negative number of days.");
      return;
    }
    if (!modalDate) {
      setError("Effective date is required.");
      return;
    }
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setError("Select at least one party.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/config/credit-period/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonical_ids: ids,
          credit_days: days,
          valid_from: modalDate,
          reason_note: modalNote.trim() || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as {
        applied?: number;
        failed?: { canonical_id: string; message: string }[];
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(payload?.message ?? `Request failed (${res.status})`);
      }
      const applied = payload?.applied ?? 0;
      const failedCount = payload?.failed?.length ?? 0;
      setResultMsg(
        failedCount > 0
          ? `Applied to ${applied}. ${failedCount} failed.`
          : `Applied to ${applied} parties.`,
      );
      setSelected(new Set());
      setModalOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk update failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-64 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search party name…"
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
        <select
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          onChange={(e) =>
            setSourceFilter(
              e.target.value as "ALL" | "party" | "entity_default" | "none",
            )
          }
          value={sourceFilter}
        >
          <option value="ALL">All sources</option>
          <option value="party">Party override</option>
          <option value="entity_default">Entity default</option>
          <option value="none">No credit period</option>
        </select>

        <div className="ml-auto flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
          <span>
            <span className="font-semibold text-[var(--color-text)]">
              {selected.size}
            </span>{" "}
            selected · {filtered.length} of {parties.length} shown
          </span>
          {canEdit ? (
            <button
              className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-50"
              disabled={selected.size === 0}
              onClick={openBulkModal}
              type="button"
            >
              Set credit period…
            </button>
          ) : null}
        </div>
      </div>

      {resultMsg ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs text-[var(--color-text)]">
          {resultMsg}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full table-auto text-sm">
          <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="w-10 px-3 py-2">
                {canEdit ? (
                  <input
                    aria-label="Select all visible"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    type="checkbox"
                  />
                ) : null}
              </th>
              <ThSortable
                active={sortKey === "name"}
                dir={sortDir}
                label="Party"
                onClick={() => changeSort("name")}
              />
              <ThSortable
                active={sortKey === "entity"}
                dir={sortDir}
                label="Entity"
                onClick={() => changeSort("entity")}
              />
              <ThSortable
                active={sortKey === "days"}
                dir={sortDir}
                label="Credit days"
                onClick={() => changeSort("days")}
              />
              <ThSortable
                active={sortKey === "source"}
                dir={sortDir}
                label="Source"
                onClick={() => changeSort("source")}
              />
              <th className="px-3 py-2">Effective from</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {filtered.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-[var(--color-text-muted)]"
                  colSpan={7}
                >
                  No parties match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const isSelected = selected.has(p.canonical_id);
                return (
                  <tr
                    className={
                      isSelected ? "bg-[var(--color-accent-bg-subtle,var(--color-bg-subtle))]" : ""
                    }
                    key={p.canonical_id}
                  >
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <input
                          aria-label={`Select ${p.canonical_name}`}
                          checked={isSelected}
                          onChange={() => toggleOne(p.canonical_id)}
                          type="checkbox"
                        />
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <Link
                        className="text-[var(--color-accent)] hover:underline"
                        href={`/party/${p.canonical_id}`}
                      >
                        {p.canonical_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{p.entity_code}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.credit_days === null ? (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      ) : (
                        <span>{p.credit_days} days</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <SourceBadge source={p.source} />
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {p.valid_from ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">
                      {p.reason_note ? (
                        <span className="italic">&ldquo;{p.reason_note}&rdquo;</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
        >
          <form
            className="w-full max-w-md space-y-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-lg"
            onSubmit={submitBulk}
          >
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                Set credit period
              </h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Apply to{" "}
                <span className="font-semibold text-[var(--color-text)]">
                  {selected.size}
                </span>{" "}
                selected{" "}
                {selected.size === 1 ? "party" : "parties"}. A new versioned row
                is created for each; any prior open row is closed.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  className="mb-1 block text-xs text-[var(--color-text-muted)]"
                  htmlFor="bulk-days"
                >
                  Credit days
                </label>
                <input
                  autoFocus
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  id="bulk-days"
                  inputMode="numeric"
                  min="0"
                  onChange={(e) => setModalDays(e.target.value)}
                  placeholder="e.g. 30"
                  required
                  type="number"
                  value={modalDays}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-xs text-[var(--color-text-muted)]"
                  htmlFor="bulk-date"
                >
                  Effective from
                </label>
                <input
                  className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  id="bulk-date"
                  onChange={(e) => setModalDate(e.target.value)}
                  required
                  type="date"
                  value={modalDate}
                />
              </div>
            </div>

            <div>
              <label
                className="mb-1 block text-xs text-[var(--color-text-muted)]"
                htmlFor="bulk-note"
              >
                Reason note (optional)
              </label>
              <input
                className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                id="bulk-note"
                onChange={(e) => setModalNote(e.target.value)}
                placeholder="e.g. Quarterly review batch"
                type="text"
                value={modalNote}
              />
            </div>

            {error ? (
              <p className="text-xs text-[var(--color-status-danger-text)]">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-bg-muted)]"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-50"
                disabled={submitting}
                type="submit"
              >
                {submitting ? "Applying…" : `Apply to ${selected.size}`}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function ThSortable({
  active,
  dir,
  label,
  onClick,
}: {
  active: boolean;
  dir: "asc" | "desc";
  label: string;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2">
      <button
        className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        onClick={onClick}
        type="button"
      >
        {label}
        {active ? <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span> : null}
      </button>
    </th>
  );
}

function SourceBadge({ source }: { source: "party" | "entity_default" | "none" }) {
  if (source === "party") {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--color-accent-bg,var(--color-bg-subtle))] px-2 py-0.5 text-xs text-[var(--color-accent)]">
        Party override
      </span>
    );
  }
  if (source === "entity_default") {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--color-bg-muted)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
        Entity default
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-bg-muted)] px-2 py-0.5 text-xs text-[var(--color-status-warning-text,var(--color-text-muted))]">
      Not set
    </span>
  );
}
