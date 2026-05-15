import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function statusBadge(status: string) {
  const colorClass =
    status === "OPEN"
      ? "border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]"
      : "border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]";
  return (
    <span className={`rounded-full px-2 py-1 text-xs ${colorClass}`}>
      {status}
    </span>
  );
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

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="space-y-2">
          <Link
            className="text-sm text-[var(--color-accent)] hover:underline"
            href="/"
          >
            {"<- Dashboard"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {invoice.invoice_ref}
            </h1>
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
              {invoice.entity_code}
            </span>
            {statusBadge(invoice.status)}
          </div>
          <Link
            href={`/party/${invoice.canonical_id}`}
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            {invoice.canonical_name}
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Date</CardTitle>
            </CardHeader>
            <CardContent>{formatDate(invoice.invoice_date)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Due Date</CardTitle>
            </CardHeader>
            <CardContent>{formatDate(invoice.due_date)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Amount</CardTitle>
            </CardHeader>
            <CardContent>
              {formatMoney(invoice.amount, invoice.currency)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Credit Days</CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.credit_days_applied} ({invoice.credit_days_source})
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Currency</CardTitle>
            </CardHeader>
            <CardContent>{invoice.currency}</CardContent>
          </Card>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Snapshot History</CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.snapshot_history.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No snapshot history available.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
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
                            {BUCKET_LABELS[row.bucket] ?? row.bucket}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exception Tags</CardTitle>
            </CardHeader>
            <CardContent>
              {invoice.exception_tags.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No exceptions tagged.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
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
                            {statusBadge(tag.status)}
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
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
