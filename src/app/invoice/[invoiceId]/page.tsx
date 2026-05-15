import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Phone, ShieldAlert } from "lucide-react";
import { EmptyState, MetricCard, PageFrame, PageHeader, Panel, PanelHeader, RightRail } from "@/components/ui/workspace";
import { TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import { getInteractiveRowClass } from "@/components/ui/table-row-styles";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import {
  getInvoiceDetail,
  getInvoiceEntityId,
} from "@/server/invoices/service";

const BUCKET_LABELS: Record<string, string> = {
  NOT_DUE: "Not Due",
  "0_30": "0-30",
  "31_60": "31-60",
  "61_90": "61-90",
  "90_PLUS": "90+",
};

function formatMoney(value: string, currency: string): string {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(numberValue);
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function nextActionLabel(invoice: Awaited<ReturnType<typeof getInvoiceDetail>>) {
  if (!invoice) return "Review invoice";
  if (invoice.exception_tags.some((tag) => tag.status === "ACTIVE")) {
    return "Resolve active exception";
  }
  if (invoice.snapshot_history.some((row) => row.bucket === "90_PLUS")) {
    return "Escalation review";
  }
  if (invoice.status === "OPEN") return "Log collection follow-up";
  return "Review audit trail";
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const currentUser = await requirePageRole(
    `/invoice/${invoiceId}`,
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  const entityId = await getInvoiceEntityId(invoiceId);

  if (!entityId) {
    notFound();
  }

  await assertAnalystCanAccessEntity(currentUser, entityId);

  const invoice = await getInvoiceDetail(invoiceId);

  if (!invoice) {
    notFound();
  }

  const activeExceptionCount = invoice.exception_tags.filter(
    (tag) => tag.status === "ACTIVE",
  ).length;
  const latestSnapshot = invoice.snapshot_history[0] ?? null;
  const nextAction = nextActionLabel(invoice);

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href={`/follow-ups?invoice_id=${invoiceId}`}
            >
              <Phone className="h-4 w-4" />
              Log follow-up
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 text-sm font-medium text-[var(--color-status-danger-text)] transition-colors hover:bg-[var(--color-danger-soft)]"
              href={`/exceptions?invoice_id=${invoiceId}`}
            >
              <ShieldAlert className="h-4 w-4" />
              Review exceptions
            </Link>
          </>
        }
        eyebrow={
          <Link
            className="inline-flex items-center gap-1 text-[var(--color-accent)]"
            href="/invoices"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Invoice Workbench
          </Link>
        }
        title={invoice.invoice_ref}
      >
        {invoice.entity_code} invoice for{" "}
        <Link
          className="font-medium text-[var(--color-accent)] hover:underline"
          href={`/party/${invoice.canonical_id}`}
        >
          {invoice.canonical_name}
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <StatusTag status={invoice.entity_code} label={invoice.entity_code} />
        <StatusTag status={invoice.status} />
        {latestSnapshot ? <StatusTag status={latestSnapshot.bucket} /> : null}
        {activeExceptionCount > 0 ? (
          <StatusTag label={`${activeExceptionCount} active exception${activeExceptionCount === 1 ? "" : "s"}`} status="STAGING_BLOCKED" />
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Invoice Date" meta="Source workbook date" value={formatDate(invoice.invoice_date)} />
        <MetricCard label="Due Date" meta="Computed from EMB terms" value={formatDate(invoice.due_date)} />
        <MetricCard label="Invoice Amount" meta={invoice.currency} value={formatMoney(invoice.amount, invoice.currency)} />
        <MetricCard label="Credit Days" meta={invoice.credit_days_source} value={invoice.credit_days_applied} />
        <MetricCard label="Active Exceptions" meta="Blocking collection flow" value={activeExceptionCount} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title="Snapshot History">
              Ageing uses each snapshot as-of date, not wall-clock today.
            </PanelHeader>
            <div className="p-4">
              {invoice.snapshot_history.length === 0 ? (
                <EmptyState
                  description="Snapshot ageing rows will appear after this invoice is included in a published workbook."
                  title="No snapshot history available"
                />
              ) : (
                <TableShell>
                  <table className="w-full min-w-[720px] table-auto text-sm">
                    <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-3 py-2">As Of Date</th>
                        <th className="px-3 py-2 text-right">Outstanding</th>
                        <th className="px-3 py-2 text-right">Overdue Days</th>
                        <th className="px-3 py-2">Bucket</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-strong)]">
                      {invoice.snapshot_history.map((row) => (
                        <tr
                          className={getInteractiveRowClass()}
                          key={`${row.snapshot_id}-${row.as_of_date}`}
                        >
                          <td className="px-3 py-2">
                            {formatDate(row.as_of_date)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatMoney(
                              row.outstanding_amount,
                              invoice.currency,
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.overdue_days}
                          </td>
                          <td className="px-3 py-2">
                            <StatusTag
                              label={BUCKET_LABELS[row.bucket] ?? row.bucket}
                              status={row.bucket}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Exception Tags">
              Collection blockers and resolution evidence linked to this invoice.
            </PanelHeader>
            <div className="p-4">
              {invoice.exception_tags.length === 0 ? (
                <EmptyState
                  description="If the invoice becomes disputed, legal, credit-note pending, or written off, the active exception will appear here."
                  title="No active exception tags"
                />
              ) : (
                <TableShell>
                  <table className="w-full min-w-[920px] table-auto text-sm">
                    <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-3 py-2">Bucket Type</th>
                        <th className="px-3 py-2">Reason</th>
                        <th className="px-3 py-2">Tagged By</th>
                        <th className="px-3 py-2">Tagged At</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Expected Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-strong)]">
                      {invoice.exception_tags.map((tag) => (
                        <tr
                          className={getInteractiveRowClass()}
                          key={tag.id}
                        >
                          <td className="px-3 py-2">
                            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1 text-xs">
                              {tag.bucket_type_name || tag.bucket_type_code}
                            </span>
                          </td>
                          <td className="max-w-[220px] px-3 py-2 text-[var(--color-text-muted)]">
                            {tag.reason}
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-muted)]">
                            {tag.tagged_by_email}
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-muted)]">
                            {formatDateTime(tag.tagged_at)}
                          </td>
                          <td className="px-3 py-2">
                            <StatusTag status={tag.status} />
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-muted)]">
                            {tag.expected_resolution_date
                              ? formatDate(tag.expected_resolution_date)
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableShell>
              )}
            </div>
          </Panel>
        </div>

        <RightRail>
          <Panel>
            <PanelHeader title="Next Best Action">Explainable review path.</PanelHeader>
            <div className="space-y-3 p-4">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  {nextAction}
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Based on invoice status, latest ageing bucket, and active exception tags.
                </p>
              </div>
              <Link
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                href={`/follow-ups?invoice_id=${invoiceId}`}
              >
                Log collection follow-up
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Linked Records">Move without losing context.</PanelHeader>
            <div className="space-y-2 p-4">
              {[
                ["Account", `/party/${invoice.canonical_id}`],
                ["Follow-ups", `/follow-ups?invoice_id=${invoiceId}`],
                ["Exceptions", `/exceptions?invoice_id=${invoiceId}`],
                ["Tasks", `/tasks?canonical_id=${invoice.canonical_id}`],
              ].map(([label, href]) => (
                <Link
                  className="flex h-10 items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                  href={href}
                  key={href}
                >
                  {label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ))}
            </div>
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
