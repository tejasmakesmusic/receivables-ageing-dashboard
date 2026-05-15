"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Users } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import type {
  BulkMapPartiesResult,
  PartyGroupSummary,
  PartyMappingSummary,
} from "@/server/snapshots/service";

type ActionState = "idle" | "mapping" | "error";

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <span
        className={[
          "block text-xl font-semibold tabular-nums",
          accent && value > 0
            ? "text-[var(--color-accent)]"
            : "text-[var(--color-text)]",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
    </div>
  );
}

function ReviewGroupItem({ group }: { group: PartyGroupSummary }) {
  const conflict = group.conflicts[0];
  const badge =
    group.match_status === "FUZZY_LOW"
      ? "Low match"
      : group.match_status === "UNMAPPED"
        ? "No match"
        : "Conflict";
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-status-warning-text)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-text)]">
          {group.display_name}
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {group.row_count} {group.row_count === 1 ? "row" : "rows"}
          {conflict ? ` · ${conflict.message}` : ""}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-[var(--color-status-warning-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-status-warning-text)]">
        {badge}
      </span>
    </div>
  );
}

export function PartyMappingPanel({
  summary,
  snapshotId,
}: {
  summary: PartyMappingSummary;
  snapshotId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [, startTransition] = useTransition();

  const hasActionable = summary.bulk_actionable_count > 0;
  const reviewGroups = summary.groups.filter(
    (g) =>
      !g.bulk_actionable &&
      g.match_status !== "RESOLVED" &&
      g.row_count > 0,
  );
  const allDone =
    !hasActionable &&
    reviewGroups.length === 0 &&
    summary.already_resolved === summary.total_invoice_rows;

  async function handleBulkMap() {
    setState("mapping");
    setMessage("");
    try {
      const res = await fetch(
        `/api/snapshots/${snapshotId}/staging/bulk-party-map`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;
        throw new Error(
          err?.message ?? err?.error ?? `Request failed ${res.status}`,
        );
      }
      const result = (await res.json()) as BulkMapPartiesResult;
      setState("idle");
      const created = result.parties_created;
      toast.success(
        [
          `Mapped ${result.rows_mapped} ${result.rows_mapped === 1 ? "row" : "rows"}.`,
          created > 0
            ? `Created ${created} new ${created === 1 ? "party" : "parties"}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setState("error");
      const msg =
        error instanceof Error ? error.message : "Bulk party mapping failed";
      setMessage(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
        <div className="flex items-center gap-3">
          {allDone ? (
            <CheckCircle2 className="h-4 w-4 text-[var(--color-status-current-text)]" />
          ) : (
            <Users className="h-4 w-4 text-[var(--color-text-muted)]" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Party Mapping
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {allDone
                ? "All parties mapped — ready to publish."
                : hasActionable
                  ? `${summary.bulk_actionable_count} ${summary.bulk_actionable_count === 1 ? "row" : "rows"} can be mapped in one click.`
                  : reviewGroups.length > 0
                    ? `${reviewGroups.length} ${reviewGroups.length === 1 ? "party" : "parties"} require manual review.`
                    : "Review parties before publishing."}
            </p>
          </div>
        </div>
        {hasActionable ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)] disabled:pointer-events-none disabled:opacity-50"
            disabled={state === "mapping"}
            onClick={handleBulkMap}
            type="button"
          >
            {state === "mapping"
              ? "Mapping…"
              : `Create & Map All Parties (${summary.bulk_actionable_count} rows)`}
          </button>
        ) : null}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-px border-b border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-6">
        <StatCell label="Total Rows" value={summary.total_invoice_rows} />
        <StatCell label="Unique Parties" value={summary.unique_parties} />
        <StatCell label="Already Exist" value={summary.already_existing} />
        <StatCell
          accent
          label="Suggested Match"
          value={summary.suggested_matches}
        />
        <StatCell
          accent
          label="New to Create"
          value={summary.new_to_create}
        />
        <StatCell
          label="Needs Review"
          value={summary.fuzzy_low_count + summary.conflict_count}
        />
      </div>

      {/* Manual review list */}
      {reviewGroups.length > 0 ? (
        <div className="p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-subtle)]">
            Requires Manual Review ({reviewGroups.length})
          </p>
          <div className="space-y-2">
            {reviewGroups.map((group) => (
              <ReviewGroupItem group={group} key={group.normalized_key} />
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Use the row-level actions in the staging table to resolve these
            parties individually.
          </p>
        </div>
      ) : null}

      {message ? (
        <p
          aria-live="polite"
          className="px-4 pb-3 text-sm text-[var(--color-status-danger-text)]"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
