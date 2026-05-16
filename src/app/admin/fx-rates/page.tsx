import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";
import { formatDateTime } from "@/lib/format";
import { listFxRates } from "@/server/config/fxRates";
import { requirePageRole } from "@/server/core/page-auth";
import { FxRateForm } from "./_components/fx-rate-form";

export const dynamic = "force-dynamic";

export default async function FxRatesPage() {
  const currentUser = await requirePageRole("/admin/fx-rates", role_enum.ADMIN);
  const fxRates = await listFxRates(
    { page: 1, page_size: 100 },
    currentUser,
  );

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
            href="/admin"
          >
            ← Admin
          </Link>
        }
        title="FX Rates"
      >
        Manage the immutable FX rate history. New rates supersede prior rows
        from their <code>valid_from</code> date.
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <PanelHeader
            action={
              <StatusTag
                label={`${fxRates.total} rate${fxRates.total === 1 ? "" : "s"}`}
                status="READ_ONLY"
              />
            }
            title="History"
          >
            Sorted by effective_from descending. Pinned to invoice_date at
            publish time — never mutated.
          </PanelHeader>
          <TableShell>
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3">Pair</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                  <th className="px-4 py-3">Valid from</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Created by</th>
                  <th className="px-4 py-3">Created at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {fxRates.items.length === 0 ? (
                  <EmptyTableRow colSpan={6}>
                    <EmptyState
                      description="Add the first FX rate using the form on the right."
                      title="No FX rates yet"
                    />
                  </EmptyTableRow>
                ) : (
                  fxRates.items.map((rate) => (
                    <tr key={rate.id}>
                      <td className="px-4 py-3 font-mono text-xs">
                        {rate.from_ccy} → {rate.to_ccy}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {rate.rate}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {rate.valid_from}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {rate.source}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {rate.created_by_email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {formatDateTime(rate.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableShell>
        </Panel>

        <RightRail>
          <Panel>
            <PanelHeader
              action={<StatusTag label="Admin only" status="STAGING_BLOCKED" />}
              title="Add FX rate"
            >
              Immutable once saved. Recorded in audit log.
            </PanelHeader>
            <FxRateForm />
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
