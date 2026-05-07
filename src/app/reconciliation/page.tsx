import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Database,
  FileSpreadsheet,
  RefreshCw,
  Scale,
} from "lucide-react";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { assertNotPending } from "@/server/core/assertNotPending";
import { requirePageRole } from "@/server/core/page-auth";

export const dynamic = "force-dynamic";

function money(value: { toString: () => string } | null | undefined) {
  return value ? value.toString() : null;
}

export default async function ReconciliationPage() {
  const user = await requirePageRole(
    "/reconciliation",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const snapshots =
    user.role === role_enum.ANALYST && !user.entityIdScope
      ? []
      : await getPrisma().snapshots.findMany({
          where: {
            status: "PUBLISHED",
            ...(user.role === role_enum.ANALYST && user.entityIdScope
              ? { entity_id: user.entityIdScope }
              : {}),
          },
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
  const matched = snapshots.filter(
    (snapshot) => snapshot.reconciliation_entries?.status === "MATCHED",
  ).length;
  const mismatched = snapshots.filter(
    (snapshot) => snapshot.reconciliation_entries?.status === "MISMATCHED",
  ).length;
  const unreconciled = snapshots.filter(
    (snapshot) => !snapshot.reconciliation_entries,
  ).length;
  const selectedSnapshot = snapshots[0] ?? null;
  const selectedReconciliation = selectedSnapshot?.reconciliation_entries;

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href="/admin/reconciliation"
          >
            Admin Tie-Out
            <ArrowRight className="h-4 w-4" />
          </Link>
        }
        title="Reconciliation Center"
      >
        Snapshot tie-out for dashboard AR, accounting closing AR, and review
        exceptions.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Published Snapshots" meta="Ready for tie-out" value={total} />
        <MetricCard label="Matched" meta="Dashboard and closing AR aligned" value={matched} />
        <MetricCard label="Mismatched" meta="Needs review before close" value={mismatched} />
        <MetricCard label="Unreconciled" meta="No tie-out entry yet" value={unreconciled} />
      </section>

      <Panel>
        <div className="grid gap-3 p-4 md:grid-cols-5">
          {[
            {
              detail: `${total} published snapshot inputs`,
              icon: FileSpreadsheet,
              status: total > 0 ? "PUBLISHED" : "NO_DATA",
              title: "Import Snapshot",
            },
            {
              detail: "Columns and ageing rows validated upstream",
              icon: Database,
              status: total > 0 ? "PUBLISHED" : "NO_DATA",
              title: "Map Workbook",
            },
            {
              detail: "Dashboard AR compared to closing AR",
              icon: Scale,
              status: mismatched > 0 ? "MISMATCHED" : matched > 0 ? "MATCHED" : "NO_DATA",
              title: "Snapshot Tie-Out",
            },
            {
              detail: `${mismatched} mismatch items in review`,
              icon: AlertTriangle,
              status: mismatched > 0 ? "MISMATCHED" : "MATCHED",
              title: "Review Exceptions",
            },
            {
              detail: "Close after tie-out approval",
              icon: RefreshCw,
              status: unreconciled > 0 ? "RECONCILIATION_PENDING" : "MATCHED",
              title: "Finalize",
            },
          ].map((step, index) => {
            const Icon = step.icon;

            return (
              <div
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                key={step.title}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">
                    {index + 1}
                  </span>
                  <Icon className="h-4 w-4 text-[var(--color-text-muted)]" />
                </div>
                <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">
                  {step.title}
                </div>
                <div className="mt-1 min-h-8 text-xs text-[var(--color-text-muted)]">
                  {step.detail}
                </div>
                <div className="mt-3">
                  <StatusTag status={step.status} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHeader title="Snapshot Tie-Out Queue">
            Supported reconciliation is currently workbook snapshot to
            dashboard AR.
          </PanelHeader>
          <TableShell>
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3">As Of Date</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Dashboard AR</th>
                  <th className="px-4 py-3 text-right">Closing AR</th>
                  <th className="px-4 py-3 text-right">Delta</th>
                  <th className="px-4 py-3">Entered By</th>
                  <th className="px-4 py-3">Snapshot</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {snapshots.length === 0 ? (
                  <EmptyTableRow colSpan={8}>
                    <EmptyState
                      description="Published snapshots will appear here after workbook upload, parse review, and publish."
                      title="No published snapshots"
                    />
                  </EmptyTableRow>
                ) : (
                  snapshots.map((snapshot) => {
                    const reconciliation = snapshot.reconciliation_entries;
                    const status = reconciliation?.status ?? "UNRECONCILED";
                    const currency = snapshot.entities.base_currency;

                    return (
                      <tr className="hover:bg-[var(--color-bg-subtle)]" key={snapshot.id}>
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
                          {formatCurrency(money(reconciliation?.dashboard_ar), currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(
                            money(reconciliation?.tally_xero_closing_ar),
                            currency,
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(money(reconciliation?.delta), currency)}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {reconciliation?.users?.email ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            className="font-medium text-[var(--color-accent)]"
                            href={`/snapshots/${snapshot.id}`}
                          >
                            View
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

        <RightRail>
          <Panel>
            <PanelHeader title="Selected Snapshot">
              {selectedSnapshot
                ? formatDate(selectedSnapshot.as_of_date)
                : "No snapshot selected"}
            </PanelHeader>
            {selectedSnapshot ? (
              <div className="space-y-4 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">Entity</span>
                  <span className="font-semibold">{selectedSnapshot.entities.code}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">Tie-out status</span>
                  <StatusTag
                    status={selectedReconciliation?.status ?? "UNRECONCILED"}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--color-text-muted)]">Entered</span>
                  <span>
                    {selectedReconciliation?.entered_at
                      ? formatDateTime(selectedReconciliation.entered_at)
                      : "-"}
                  </span>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-3 text-[var(--color-text-muted)]">
                  Tie-out notes and closing AR values are captured from the
                  reconciliation entry associated with this published snapshot.
                </div>
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  description="Select a published snapshot after data is available."
                  title="No transaction details"
                />
              </div>
            )}
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
