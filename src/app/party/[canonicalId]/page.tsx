import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Phone,
  ShieldAlert,
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
import { formatCurrency, formatDate } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { getPartyDetail, getPartyEntityId } from "@/server/parties/service";

export const dynamic = "force-dynamic";

function healthStatus(worstBucket: string | null, exceptionCount: number) {
  if (worstBucket === "90_PLUS" || exceptionCount > 0) return "90_PLUS";
  if (worstBucket === "61_90" || worstBucket === "31_60") return "31_60";
  return "NOT_DUE";
}

export default async function PartyDetailPage({
  params,
}: {
  params: Promise<{ canonicalId: string }>;
}) {
  const { canonicalId } = await params;
  const currentUser = await requirePageRole(
    `/party/${canonicalId}`,
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  const entityId = await getPartyEntityId(canonicalId);

  if (!entityId) {
    notFound();
  }

  await assertAnalystCanAccessEntity(currentUser, entityId);

  const party = await getPartyDetail(canonicalId);

  if (!party) {
    notFound();
  }

  const worstBucket =
    party.invoices
      .map((invoice) => invoice.bucket)
      .find((bucket) => bucket === "90_PLUS") ??
    party.invoices
      .map((invoice) => invoice.bucket)
      .find((bucket) => bucket === "61_90") ??
    party.invoices
      .map((invoice) => invoice.bucket)
      .find((bucket) => bucket === "31_60") ??
    party.invoices
      .map((invoice) => invoice.bucket)
      .find((bucket) => bucket === "0_30") ??
    "NOT_DUE";
  const overdueInvoices = party.invoices.filter(
    (invoice) => invoice.bucket && invoice.bucket !== "NOT_DUE",
  );
  const maxDaysLate = Math.max(
    0,
    ...party.invoices.map((invoice) => invoice.overdue_days ?? 0),
  );
  const isReadOnly = currentUser.role === role_enum.CFO;

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href={`/follow-ups?canonical_id=${party.canonical_id}`}
            >
              <Phone className="h-4 w-4" />
              Log Activity
            </Link>
            <Link
              className={[
                "inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border px-3 text-sm font-medium transition-colors",
                isReadOnly
                  ? "pointer-events-none border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text-subtle)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]",
              ].join(" ")}
              href={`/promises-to-pay?canonical_id=${party.canonical_id}`}
            >
              <CalendarCheck className="h-4 w-4" />
              Create Promise
            </Link>
            <Link
              className={[
                "inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border px-3 text-sm font-medium transition-colors",
                isReadOnly
                  ? "pointer-events-none border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text-subtle)]"
                  : "border-red-300 bg-white text-red-600 hover:bg-red-50",
              ].join(" ")}
              href={`/tasks?canonical_id=${party.canonical_id}`}
            >
              <ShieldAlert className="h-4 w-4" />
              Escalate
            </Link>
          </>
        }
        eyebrow={
          <Link
            className="inline-flex items-center gap-1 text-[var(--color-accent)]"
            href="/parties"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Parties
          </Link>
        }
        title={party.canonical_name}
      >
        {party.entity_code} - {party.currency_display} - Open invoice view and
        outstanding summary.
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <StatusTag status={party.entity_code} label={party.entity_code} />
        <StatusTag status={worstBucket} />
        <StatusTag
          label={
            healthStatus(worstBucket, party.active_exception_count) === "90_PLUS"
              ? "At Risk"
              : healthStatus(worstBucket, party.active_exception_count) === "31_60"
                ? "Watch"
                : "Good"
          }
          status={healthStatus(worstBucket, party.active_exception_count)}
        />
        {isReadOnly ? <StatusTag status="READ_ONLY" /> : null}
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Total Exposure"
          meta="Open invoice outstanding"
          value={formatCurrency(party.total_outstanding, party.currency_display)}
        />
        <MetricCard
          label="Overdue Invoices"
          meta="Based on computed ageing"
          value={overdueInvoices.length}
        />
        <MetricCard label="Max Days Late" meta="Latest snapshot" value={maxDaysLate} />
        <MetricCard
          label="Active Exceptions"
          meta="Control tags still open"
          value={party.active_exception_count}
        />
        <MetricCard
          label="Open Invoices"
          meta="Current receivables"
          value={party.active_invoice_count}
        />
      </section>

      <nav className="flex flex-wrap gap-6 border-b border-[var(--color-border)] text-sm">
        <a
          className="border-b-2 border-[var(--color-accent)] pb-3 font-medium text-[var(--color-accent)]"
          href="#overview"
        >
          Overview
        </a>
        {[
          ["Invoices", `/invoices?party_canonical_id=${party.canonical_id}`],
          ["Activity", `/follow-ups?canonical_id=${party.canonical_id}`],
          ["Promises", `/promises-to-pay?canonical_id=${party.canonical_id}`],
          ["Disputes", `/dispute-cases?canonical_id=${party.canonical_id}`],
          ["Tasks", `/tasks?canonical_id=${party.canonical_id}`],
        ].map(([label, href]) => (
          <Link
            className="pb-3 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
            href={href}
            key={href}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel id="overview">
            <PanelHeader
              action={
                <Link
                  className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-accent)]"
                  href={`/invoices?party_canonical_id=${party.canonical_id}`}
                >
                  View all invoices
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
              title={`Open Invoices (${party.invoices.length})`}
            >
              {formatCurrency(party.total_outstanding, party.currency_display)}
            </PanelHeader>
            <TableShell>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Invoice #</th>
                    <th className="px-4 py-3">Invoice Date</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3">Bucket</th>
                    <th className="px-4 py-3 text-right">Exceptions</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {party.invoices.length === 0 ? (
                    <EmptyTableRow colSpan={8}>
                      No open invoices for this account.
                    </EmptyTableRow>
                  ) : (
                    party.invoices.map((invoice) => (
                      <tr
                        className="transition-colors hover:bg-[var(--color-bg-subtle)]"
                        key={invoice.invoice_id}
                      >
                        <td className="px-4 py-3 font-mono">
                          <Link
                            className="font-medium text-[var(--color-accent)] hover:underline"
                            href={`/invoice/${invoice.invoice_id}`}
                          >
                            {invoice.invoice_ref}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {formatDate(invoice.invoice_date)}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {formatDate(invoice.due_date)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(invoice.amount, invoice.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(
                            invoice.outstanding_amount ?? invoice.amount,
                            invoice.currency,
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={invoice.bucket} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {invoice.active_exception_count}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={invoice.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableShell>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel className="p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Key Contacts
              </h2>
              <EmptyState
                description="Follow-up notes remain the auditable contact trail for this account."
                title="No dedicated contacts"
              />
            </Panel>
            <Panel className="p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Promises to Pay
              </h2>
              <EmptyState
                action={
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href={`/promises-to-pay?canonical_id=${party.canonical_id}`}
                  >
                    View promises
                  </Link>
                }
                description="Open and broken promises for this account appear in the promise register."
                title="No promises loaded here"
              />
            </Panel>
            <Panel className="p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Dispute Summary
              </h2>
              <EmptyState
                action={
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href={`/dispute-cases?canonical_id=${party.canonical_id}`}
                  >
                    View disputes
                  </Link>
                }
                description="Dispute cases are tracked separately from exception tags."
                title="No dispute panel data"
              />
            </Panel>
          </div>
        </div>

        <RightRail>
          <Panel>
            <PanelHeader title="Next Best Action">Explainable and auditable.</PanelHeader>
            <div className="space-y-3 p-4">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-medium text-[var(--color-text)]">
                  {party.active_exception_count > 0
                    ? "Review active exceptions"
                    : overdueInvoices.length > 0
                      ? "Log follow-up"
                      : "Monitor account"}
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Suggested from open invoices, ageing bucket, and active
                  exception count.
                </p>
              </div>
              <Link
                className={[
                  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 text-sm font-medium",
                  isReadOnly
                    ? "pointer-events-none border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text-subtle)]"
                    : "border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)]",
                ].join(" ")}
                href={`/follow-ups?canonical_id=${party.canonical_id}`}
              >
                Log Follow-up
              </Link>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Recent Reminders">
              Approved reminder activity.
            </PanelHeader>
            <div className="p-4">
              <EmptyState
                description="Reminder events from approved email rules appear here."
                title="No reminders sent"
              />
            </div>
          </Panel>

          <Panel className="p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Quick Actions
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
                href={`/follow-ups?canonical_id=${party.canonical_id}`}
              >
                Log Note
              </Link>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
                href={`/tasks?canonical_id=${party.canonical_id}`}
              >
                Queue
              </Link>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
                href={`/promises-to-pay?canonical_id=${party.canonical_id}`}
              >
                Promise
              </Link>
              <Link
                className="inline-flex h-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
                href={`/invoices?party_canonical_id=${party.canonical_id}`}
              >
                Invoices
              </Link>
            </div>
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
