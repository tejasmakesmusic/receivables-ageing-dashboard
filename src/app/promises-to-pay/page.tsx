import { requirePageRole } from "@/server/core/page-auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { listPromisesToPay } from "@/server/promises-to-pay/service";
import { role_enum } from "@/generated/prisma/enums";
import type { promise_to_pay_status } from "@/generated/prisma/enums";
import { StatusTag } from "@/components/ui/status-tag";

export const dynamic = "force-dynamic";

const STATUS_FILTERS: { label: string; value: promise_to_pay_status | "" }[] = [
  { label: "All",       value: ""           },
  { label: "Open",      value: "OPEN"       },
  { label: "Kept",      value: "KEPT"       },
  { label: "Broken",    value: "BROKEN"     },
  { label: "Cancelled", value: "CANCELLED"  },
];

export default async function PromisesToPayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const resolvedParams = await searchParams;

  const user = await requirePageRole(
    "/promises-to-pay",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const page        = resolvedParams.page         ? Number(resolvedParams.page) : 1;
  const status      = resolvedParams.status       as promise_to_pay_status | undefined;
  const canonicalId = resolvedParams.canonical_id ?? undefined;

  const { items, total } = await listPromisesToPay(
    { status, canonical_id: canonicalId, page },
    user,
  );

  const pageSize   = 50;
  const totalPages = Math.ceil(total / pageSize);

  // Build base params without page for filter links
  const baseParams = { ...(canonicalId ? { canonical_id: canonicalId } : {}) };

  function filterHref(s: promise_to_pay_status | "") {
    const p = new URLSearchParams(baseParams);
    if (s) p.set("status", s);
    const qs = p.toString();
    return `/promises-to-pay${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-[var(--spacing-6)] py-[var(--spacing-4)] border-b border-[var(--color-border)]">
        <div>
          <h1 className="text-base font-semibold text-[var(--color-text)]">
            Promises to Pay
          </h1>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {total} promise{total !== 1 ? "s" : ""}
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
              <th className="text-right px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Amount</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Currency</th>
              <th className="text-left px-[var(--spacing-4)] py-[var(--spacing-2)] text-xs font-medium text-[var(--color-text-muted)]">Promised Date</th>
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
                  No promises to pay found.
                </td>
              </tr>
            )}
            {items.map((ptp) => (
              <tr key={ptp.id} className="hover:bg-[var(--color-bg-subtle)] transition-colors">
                <td className="px-[var(--spacing-6)] py-[var(--spacing-2)] text-[var(--color-text)]">
                  {ptp.parties_canonical?.name ?? ptp.canonical_id}
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-right text-[var(--color-text)] tabular-nums">
                  {Number(ptp.amount).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-muted)]">
                  {ptp.currency}
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-muted)]">
                  {ptp.promised_date.toISOString().slice(0, 10)}
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-2)]">
                  <StatusTag status={`PTP_${ptp.status}`} />
                </td>
                <td className="px-[var(--spacing-4)] py-[var(--spacing-2)] text-[var(--color-text-subtle)]">
                  {ptp.created_at.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center gap-[var(--spacing-2)] px-[var(--spacing-6)] py-[var(--spacing-4)] text-sm text-[var(--color-text-muted)]">
            {page > 1 && (
              <a
                href={`/promises-to-pay?${new URLSearchParams({ ...resolvedParams, page: String(page - 1) }).toString()}`}
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
                href={`/promises-to-pay?${new URLSearchParams({ ...resolvedParams, page: String(page + 1) }).toString()}`}
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
