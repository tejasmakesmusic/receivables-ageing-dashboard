import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusTag } from "@/components/ui/status-tag";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import {
  listSnapshots,
  snapshotListFiltersSchema,
} from "@/server/snapshots/service";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): string[] | undefined {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

function pageHref(
  page: number,
  params: { entity_code?: string; status?: string; page_size: number },
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

  return `/snapshots?${search.toString()}`;
}

export default async function SnapshotsPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/snapshots",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  const raw = await searchParams;
  const page = Number(first(raw.page) ?? "1");
  const pageSize = Number(first(raw.page_size) ?? "50");
  const params = {
    entity_code: first(raw.entity_code),
    status: first(raw.status),
    page_size: pageSize,
  };
  const filters = snapshotListFiltersSchema.parse({
    entity_code: params.entity_code,
    status: parseStatus(params.status),
    page,
    page_size: pageSize,
  });
  const response = await listSnapshots(filters, currentUser);
  const totalPages = Math.max(
    1,
    Math.ceil(response.total / response.page_size),
  );

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
          <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form action="/snapshots" className="grid gap-3 sm:grid-cols-4">
              <select
                className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
                defaultValue={params.entity_code ?? ""}
                name="entity_code"
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
                <option value="STAGED">STAGED</option>
                <option value="PUBLISHED">PUBLISHED</option>
                <option value="DISCARDED">DISCARDED</option>
              </select>
              <input name="page" type="hidden" value="1" />
              <input name="page_size" type="hidden" value={pageSize} />
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
            <CardTitle>Recent Uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Uploaded</th>
                    <th className="px-3 py-2">Entity</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">As Of</th>
                    <th className="px-3 py-2">Rows</th>
                    <th className="px-3 py-2 text-right">Outstanding</th>
                    <th className="px-3 py-2">By</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {response.items.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td className="px-3 py-2">
                        <Link
                          className="text-blue-700 hover:underline"
                          href={`/snapshots/${snapshot.id}`}
                        >
                          {formatDateTime(snapshot.uploaded_at)}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{snapshot.entity_code}</td>
                      <td className="px-3 py-2">{snapshot.source_hint}</td>
                      <td className="px-3 py-2">
                        {formatDate(snapshot.as_of_date)}
                      </td>
                      <td className="px-3 py-2">{snapshot.row_count ?? "-"}</td>
                      <td className="px-3 py-2 text-right">
                        {snapshot.total_outstanding
                          ? formatCurrency(
                              snapshot.total_outstanding,
                              snapshot.entity_code === "IND" ? "INR" : "AED",
                            )
                          : "-"}
                      </td>
                      <td className="px-3 py-2">
                        {snapshot.uploaded_by_email}
                      </td>
                      <td className="px-3 py-2">
                        <StatusTag status={snapshot.status} />
                      </td>
                    </tr>
                  ))}
                  {response.items.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-4 text-center text-slate-500"
                        colSpan={8}
                      >
                        No snapshots found.
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
