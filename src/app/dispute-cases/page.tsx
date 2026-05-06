import { requirePageRole } from "@/server/core/page-auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listDisputeCases } from "@/server/dispute-cases/service";
import { role_enum } from "@/generated/prisma/enums";
import type { dispute_case_status } from "@/generated/prisma/enums";
import { StatusTag } from "@/components/ui/status-tag";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { label: string; value: dispute_case_status | "" }[] = [
  { label: "All",                value: ""                    },
  { label: "Open",               value: "OPEN"                },
  { label: "In Review",          value: "IN_REVIEW"           },
  { label: "Waiting on Customer", value: "WAITING_ON_CUSTOMER" },
  { label: "Resolved",           value: "RESOLVED"            },
  { label: "Closed",             value: "CLOSED"              },
];

export default async function DisputeCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const resolvedParams = await searchParams;

  const user = await requirePageRole(
    "/dispute-cases",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const page     = resolvedParams.page      ? Number(resolvedParams.page) : 1;
  const status   = resolvedParams.status    as dispute_case_status | undefined;
  const entityId = resolvedParams.entity_id ?? undefined;

  const { items, total } = await listDisputeCases(
    { status, entity_id: entityId, page },
    user,
  );

  const pageSize   = 50;
  const totalPages = Math.ceil(total / pageSize);

  const baseParams = { ...(entityId ? { entity_id: entityId } : {}) };

  function filterHref(s: dispute_case_status | "") {
    const p = new URLSearchParams(baseParams);
    if (s) p.set("status", s);
    const qs = p.toString();
    return `/dispute-cases${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-[var(--spacing-6)] py-[var(--spacing-4)] border-b border-[var(--color-border)]">
        <div>
          <h1 className="text-base font-semibold text-[var(--color-text)]">
            Dispute Cases
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {total} case{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Status filter bar */}
      <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-2)] border-b border-[var(--color-border)] overflow-x-auto">
        {STATUS_FILTERS.map(({ label, value }) => {
          const active = (status ?? "") === value;
          return (
            <a
              key={value || "all"}
              href={filterHref(value)}
              className={[
                "inline-flex items-center rounded-[var(--radius-sm)] px-[var(--spacing-2)] py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              {label}
            </a>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--color-bg-subtle)] border-b border-[var(--color-border)]">
            <tr>
              <th className="text-left px-[var(--spacing-6)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Party</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Entity</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Reason Code</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Description</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Status</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-[var(--spacing-6)] py-[var(--spacing-6)] text-center text-[var(--color-text-muted)]"
                >
                  No dispute cases found.
                </td>
              </tr>
            )}
            {items.map((dispute) => {
              const description = dispute.description.length > 80
                ? dispute.description.slice(0, 80) + "…"
                : dispute.description;

              return (
                <tr key={dispute.id} className="hover:bg-[var(--color-bg-subtle)] transition-colors">
                  <td className="px-[var(--spacing-6)] py-[var(--spacing-2)] text-[var(--color-text)]">
                    {dispute.parties_canonical?.name ?? dispute.canonical_id}
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-muted)]">
                    {dispute.entities?.code ?? dispute.entity_id}
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-muted)] font-mono text-xs">
                    {dispute.reason_code}
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-subtle)] max-w-xs">
                    {description}
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-2)]">
                    <StatusTag status={`DISPUTE_${dispute.status}`} />
                  </td>
                  <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-subtle)]">
                    {dispute.created_at.toISOString().slice(0, 10)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-4)] text-sm text-[var(--color-text-muted)]">
            {page > 1 && (
              <a
                href={`/dispute-cases?${new URLSearchParams({ ...resolvedParams, page: String(page - 1) }).toString()}`}
                className="text-[var(--color-accent)] hover:underline"
              >
                ← Previous
              </a>
            )}
            <span>
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <a
                href={`/dispute-cases?${new URLSearchParams({ ...resolvedParams, page: String(page + 1) }).toString()}`}
                className="text-[var(--color-accent)] hover:underline"
              >
                Next →
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
