import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrencyCompact, formatDate } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { requirePageRole } from "@/server/core/page-auth";

export const dynamic = "force-dynamic";

function money(value: { toString: () => string } | null | undefined) {
  return value ? value.toString() : null;
}

export default async function AdminReconciliationPage() {
  await requirePageRole("/admin/reconciliation", role_enum.ADMIN);

  const snapshots = await getPrisma().snapshots.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { as_of_date: "desc" },
    take: 100,
    include: {
      entities: { select: { base_currency: true, code: true } },
      reconciliation_entries: {
        select: {
          dashboard_ar: true,
          delta: true,
          entered_at: true,
          id: true,
          notes: true,
          status: true,
          tally_xero_closing_ar: true,
          users: { select: { email: true } },
        },
      },
    },
  });

  const total = snapshots.length;
  const mismatched = snapshots.filter(
    (snapshot) => snapshot.reconciliation_entries?.status === "MISMATCHED",
  ).length;
  const unreconciled = snapshots.filter(
    (snapshot) => !snapshot.reconciliation_entries,
  ).length;

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href="/reconciliation"
          >
            Reconciliation Center
            <ArrowRight className="h-4 w-4" />
          </Link>
        }
        eyebrow={
          <Link className="text-[var(--color-accent)]" href="/admin">
            Admin
          </Link>
        }
        title="Admin Reconciliation"
      >
        Published snapshot tie-out status and closing AR review.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Published Snapshots" meta="Recent 100" value={total} />
        <MetricCard label="Mismatched" meta="Needs admin review" value={mismatched} />
        <MetricCard label="Unreconciled" meta="No closing AR entry" value={unreconciled} />
      </section>

      {mismatched > 0 ? (
        <Panel className="border-[var(--color-status-danger-border)] bg-[var(--color-danger-soft)] p-4">
          <div className="flex items-center gap-3 text-sm text-[var(--color-status-danger-text)]">
            <RefreshCw className="h-4 w-4" />
            {mismatched} snapshot{mismatched === 1 ? "" : "s"} have a
            reconciliation mismatch.
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Snapshot Tie-Outs">
          Analysts enter closing AR on snapshot detail pages; admins monitor
          status here.
        </PanelHeader>
        <TableShell>
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-3">As Of Date</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Dashboard AR</th>
                <th className="px-4 py-3 text-right">Tally/Xero AR</th>
                <th className="px-4 py-3 text-right">Delta</th>
                <th className="px-4 py-3">Entered By</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {snapshots.length === 0 ? (
                <EmptyTableRow colSpan={8}>
                  <EmptyState
                    description="No published snapshots are available for reconciliation yet."
                    title="No reconciliation rows"
                  />
                </EmptyTableRow>
              ) : (
                snapshots.map((snapshot) => {
                  const reconciliation = snapshot.reconciliation_entries;
                  const status = reconciliation?.status ?? "UNRECONCILED";
                  const currency = snapshot.entities.base_currency;

                  return (
                      <tr
                        className="transition-colors hover:bg-[var(--color-bg-subtle)]"
                        key={snapshot.id}
                      >
                      <td className="px-4 py-3">
                        {formatDate(snapshot.as_of_date)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag
                          label={`${snapshot.entities.code} (${currency})`}
                          status="READ_ONLY"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={status} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrencyCompact(money(reconciliation?.dashboard_ar), currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrencyCompact(
                          money(reconciliation?.tally_xero_closing_ar),
                          currency,
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrencyCompact(money(reconciliation?.delta), currency)}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {reconciliation?.users?.email ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          className="font-medium text-[var(--color-accent)]"
                          href={`/snapshots/${snapshot.id}`}
                        >
                          View snapshot
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableShell>
      </Panel>
    </PageFrame>
  );
}
