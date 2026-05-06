import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import {
  exceptionListFiltersSchema,
  listExceptions,
} from "@/server/exceptions/service";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function statusBadge(status: string) {
  const className =
    status === "ACTIVE"
      ? "border-amber-200 bg-amber-100 text-amber-800"
      : status === "RESOLVED"
        ? "border-green-200 bg-green-100 text-green-800"
        : "border-slate-200 bg-slate-100 text-slate-700";

  return (
    <Badge className={className} variant="secondary">
      {status}
    </Badge>
  );
}

function pageHref(page: number, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries({
    ...params,
    page: String(page),
  })) {
    if (value) {
      search.set(key, value);
    }
  }

  return `/exceptions?${search.toString()}`;
}

export default async function ExceptionsPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/exceptions",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  const rawParams = await searchParams;
  const params = {
    entity: first(rawParams.entity),
    status: first(rawParams.status),
    bucket_type: first(rawParams.bucket_type),
    invoice_id: first(rawParams.invoice_id),
    page: first(rawParams.page),
    page_size: first(rawParams.page_size),
  };
  const filters = exceptionListFiltersSchema.parse(params);
  const response = await listExceptions(filters, currentUser);
  const totalPages = Math.max(
    1,
    Math.ceil(response.total / response.page_size),
  );

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="space-y-2">
          <Link
            href="/dashboard"
            className="text-sm text-blue-700 hover:underline"
          >
            {"<- Dashboard"}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Exceptions
            </h1>
            <div className="flex flex-wrap gap-2 text-sm">
              {["ACTIVE", "RESOLVED", "AUTO_RESOLVED"].map((status) => (
                <Link
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 hover:bg-slate-100"
                  href={`/exceptions?status=${status}`}
                  key={status}
                >
                  {status}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Exception Tags</CardTitle>
          </CardHeader>
          <CardContent>
            {response.items.length === 0 ? (
              <p className="text-sm text-slate-500">No exceptions tagged.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2">Party</th>
                      <th className="px-3 py-2">Entity</th>
                      <th className="px-3 py-2">Bucket</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Tagged</th>
                      <th className="px-3 py-2">Expected</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {response.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 font-mono">
                          <Link
                            className="text-blue-700 hover:underline"
                            href={`/invoice/${item.invoice_id}`}
                          >
                            {item.invoice_ref}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            className="text-blue-700 hover:underline"
                            href={`/party/${item.canonical_id}`}
                          >
                            {item.canonical_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{item.entity_code}</td>
                        <td className="px-3 py-2">{item.bucket_type_name}</td>
                        <td className="max-w-[260px] px-3 py-2 text-slate-600">
                          {item.reason}
                        </td>
                        <td className="px-3 py-2">
                          <div>{item.tagged_by_email}</div>
                          <div className="text-xs text-slate-500">
                            {formatDateTime(item.tagged_at)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {formatDate(item.expected_resolution_date)}
                        </td>
                        <td className="px-3 py-2">
                          {statusBadge(item.status)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
