import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import { listInvoices } from "@/server/invoices/service";
import {
  buildSystemViewHref,
  getInvoiceSystemViewParams,
  getSystemViewsForSurface,
  parseSystemViewId,
} from "@/server/views/system-views";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function bucketBadge(bucket: string | null) {
  if (!bucket) return "-";
  const className =
    bucket === "NOT_DUE"
      ? "border-green-200 bg-green-100 text-green-800"
      : bucket === "0_30"
        ? "border-yellow-200 bg-yellow-100 text-yellow-800"
        : bucket === "31_60"
          ? "border-orange-200 bg-orange-100 text-orange-800"
          : bucket === "61_90"
            ? "border-red-200 bg-red-100 text-red-800"
            : "border-red-300 bg-red-900 text-white";

  return (
    <Badge className={className} variant="secondary">
      {bucket}
    </Badge>
  );
}

function pageHref(
  page: number,
  params: {
    entity?: string;
    status?: string;
    overdue_bucket?: string;
    has_active_exceptions?: string;
    party_canonical_id?: string;
    page_size: number;
    system_view?: string;
  },
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...params,
    page: String(page),
  })) {
    if (value) {
      search.set(key, String(value));
    }
  }

  return `/invoices?${search.toString()}`;
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/invoices",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  const raw = await searchParams;
  const page = Number(first(raw.page) ?? "1");
  const pageSize = Number(first(raw.page_size) ?? "50");
  const systemViewId = parseSystemViewId(first(raw.system_view));
  const systemViewParams = getInvoiceSystemViewParams(systemViewId);
  const params = {
    entity: first(raw.entity),
    status: systemViewParams?.status ?? first(raw.status),
    overdue_bucket:
      systemViewParams?.overdue_bucket ?? first(raw.overdue_bucket),
    has_active_exceptions: first(raw.has_active_exceptions),
    party_canonical_id: first(raw.party_canonical_id),
    page_size: pageSize,
    system_view: systemViewId ?? undefined,
  };
  const response = await listInvoices(
    {
      entity: params.entity,
      status: params.status,
      overdue_bucket: params.overdue_bucket,
      has_active_exceptions: parseBool(params.has_active_exceptions),
      party_canonical_id: params.party_canonical_id,
      page,
      page_size: pageSize,
    },
    currentUser,
  );
  const totalPages = Math.max(
    1,
    Math.ceil(response.total / response.page_size),
  );
  const systemViews = getSystemViewsForSurface("invoices");

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div className="space-y-2">
          <Link
            href="/dashboard"
            className="text-sm text-blue-700 hover:underline"
          >
            {"<- Dashboard"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
        </div>

        <nav
          aria-label="System views"
          className="flex flex-wrap gap-2 text-sm"
        >
          <Link
            aria-current={!systemViewId ? "page" : undefined}
            className={[
              "rounded border px-3 py-1.5",
              !systemViewId
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
            ].join(" ")}
            href="/invoices"
          >
            All invoices
          </Link>
          {systemViews.map((view) => {
            const active = systemViewId === view.id;

            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded border px-3 py-1.5",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                ].join(" ")}
                href={buildSystemViewHref(view.id, "invoices")}
                key={view.id}
                title={view.description}
              >
                {view.label}
              </Link>
            );
          })}
        </nav>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action="/invoices"
              className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5"
            >
              <select
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                defaultValue={params.entity ?? ""}
                name="entity"
              >
                <option value="">All entities</option>
                <option value="IND">IND</option>
                <option value="UAE">UAE</option>
              </select>
              <select
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                defaultValue={params.status ?? ""}
                name="status"
              >
                <option value="">All statuses</option>
                <option value="OPEN">OPEN</option>
                <option value="SETTLED">SETTLED</option>
              </select>
              <select
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                defaultValue={params.overdue_bucket ?? ""}
                name="overdue_bucket"
              >
                <option value="">All buckets</option>
                <option value="NOT_DUE">NOT_DUE</option>
                <option value="0_30">0_30</option>
                <option value="31_60">31_60</option>
                <option value="61_90">61_90</option>
                <option value="90_PLUS">90_PLUS</option>
              </select>
              <select
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                defaultValue={params.has_active_exceptions ?? ""}
                name="has_active_exceptions"
              >
                <option value="">Exception status</option>
                <option value="true">Has active exceptions</option>
                <option value="false">No active exceptions</option>
              </select>
              <button
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800"
                type="submit"
              >
                Apply
              </button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Register</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Party</th>
                    <th className="px-3 py-2">Entity</th>
                    <th className="px-3 py-2">Invoice Date</th>
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Bucket</th>
                    <th className="px-3 py-2 text-right">Exceptions</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {response.items.map((invoice) => (
                    <tr key={invoice.invoice_id}>
                      <td className="px-3 py-2 font-mono">
                        <Link
                          className="text-blue-700 hover:underline"
                          href={`/invoice/${invoice.invoice_id}`}
                        >
                          {invoice.invoice_ref}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          className="text-blue-700 hover:underline"
                          href={`/party/${invoice.canonical_id}`}
                        >
                          {invoice.canonical_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{invoice.entity_code}</td>
                      <td className="px-3 py-2">
                        {formatDate(invoice.invoice_date)}
                      </td>
                      <td className="px-3 py-2">
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </td>
                      <td className="px-3 py-2">
                        {bucketBadge(invoice.bucket)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {invoice.active_exception_count}
                      </td>
                      <td className="px-3 py-2">{invoice.status}</td>
                    </tr>
                  ))}
                  {response.items.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-slate-500"
                        colSpan={9}
                      >
                        No invoices found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <nav className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Page {response.page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Link
              aria-disabled={response.page <= 1}
              className="rounded border border-slate-200 bg-white px-3 py-1 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={pageHref(Math.max(1, response.page - 1), params)}
            >
              Previous
            </Link>
            <Link
              aria-disabled={response.page >= totalPages}
              className="rounded border border-slate-200 bg-white px-3 py-1 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={pageHref(Math.min(totalPages, response.page + 1), params)}
            >
              Next
            </Link>
          </div>
        </nav>
      </div>
    </main>
  );
}
