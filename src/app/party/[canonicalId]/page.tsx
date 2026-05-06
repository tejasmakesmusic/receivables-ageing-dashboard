import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { getPartyDetail, getPartyEntityId } from "@/server/parties/service";

const BUCKET_LABELS: Record<string, string> = {
  NOT_DUE: "Not Due",
  "0_30": "0-30",
  "31_60": "31-60",
  "61_90": "61-90",
  "90_PLUS": "90+",
};

function formatMoney(value: string, currency = "INR"): string {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    return "-";
  }

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

function bucketBadge(value: string | null): string {
  if (!value) return "-";
  return BUCKET_LABELS[value] ?? value;
}

function statusBadge(status: string) {
  const className =
    status === "OPEN"
      ? "border border-green-200 bg-green-100 text-green-800"
      : "border border-slate-200 bg-slate-100 text-slate-700";
  return (
    <span className={`rounded-full px-2 py-1 text-xs ${className}`}>
      {status}
    </span>
  );
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

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="space-y-2">
          <Link href="/" className="text-sm text-blue-700 hover:underline">
            {"<- Dashboard"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {party.canonical_name}
            </h1>
            <Badge>{party.entity_code}</Badge>
            <span className="text-sm text-slate-500">
              {party.currency_display}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Open invoice view and outstanding summary.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Total Outstanding</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {formatMoney(party.total_outstanding, party.currency_display)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Open Invoices</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {party.active_invoice_count}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Active Exceptions</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {party.active_exception_count}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Open Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Invoice Date</th>
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Outstanding</th>
                    <th className="px-3 py-2">Bucket</th>
                    <th className="px-3 py-2">Exceptions</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {party.invoices.map((invoice) => (
                    <tr key={invoice.invoice_id}>
                      <td className="px-3 py-2 font-mono">
                        <Link
                          href={`/invoice/${invoice.invoice_id}`}
                          className="text-blue-700 hover:underline"
                        >
                          {invoice.invoice_ref}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {formatDate(invoice.invoice_date)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatMoney(invoice.amount, invoice.currency)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {invoice.outstanding_amount
                          ? formatMoney(
                              invoice.outstanding_amount,
                              invoice.currency,
                            )
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {bucketBadge(invoice.bucket)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {invoice.active_exception_count}
                      </td>
                      <td className="px-3 py-2">
                        {statusBadge(invoice.status)}
                      </td>
                    </tr>
                  ))}
                  {party.invoices.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-slate-500"
                        colSpan={8}
                      >
                        No open invoices.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
