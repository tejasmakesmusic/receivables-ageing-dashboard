import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HttpError } from "@/server/core/errors";
import { requireRole, type AuthenticatedUser } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";
import {
  listFollowUps,
  parseFollowUpListQuery,
} from "@/server/follow-ups/service";
import CreateFollowUpForm from "./_components/create-follow-up-form";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPageHref(
  query: ReturnType<typeof parseFollowUpListQuery>,
  page: number,
): string {
  const params = new URLSearchParams();
  if (query.entity) params.set("entity", query.entity);
  if (query.channel) params.set("channel", query.channel);
  if (query.canonical_id) params.set("canonical_id", query.canonical_id);
  if (query.invoice_id) params.set("invoice_id", query.invoice_id);
  params.set("page", String(page));
  params.set("page_size", String(query.page_size));
  return `/follow-ups?${params.toString()}`;
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const fallbackQuery: ReturnType<typeof parseFollowUpListQuery> = {
    page: 1,
    page_size: 50,
  };

  let currentUser: AuthenticatedUser | null = null;
  let followUpsResponse: Awaited<ReturnType<typeof listFollowUps>> = {
    items: [],
    total: 0,
    page: fallbackQuery.page,
    page_size: fallbackQuery.page_size,
  };
  let query: ReturnType<typeof parseFollowUpListQuery> = fallbackQuery;
  let error: string | null = null;

  try {
    currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.ADMIN,
    );
    const resolvedSearchParams = (await Promise.resolve(
      searchParams || {},
    )) as Record<string, string | string[] | undefined>;
    const parsedQuery = parseFollowUpListQuery({
      entity: first(resolvedSearchParams.entity),
      channel: first(resolvedSearchParams.channel),
      canonical_id: first(resolvedSearchParams.canonical_id),
      invoice_id: first(resolvedSearchParams.invoice_id),
      page: first(resolvedSearchParams.page),
      page_size: first(resolvedSearchParams.page_size),
    });

    query = parsedQuery;
    followUpsResponse = await listFollowUps(parsedQuery, currentUser);
  } catch (caught) {
    if (caught instanceof HttpError) {
      error = caught.message;
    } else if (caught instanceof Error) {
      error = caught.message;
    } else {
      error = "Unable to load follow-ups.";
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil(followUpsResponse.total / followUpsResponse.page_size),
  );
  const canCreate =
    currentUser?.role === role_enum.ANALYST ||
    currentUser?.role === role_enum.ADMIN;
  const startIndex =
    followUpsResponse.total === 0 ? 0 : (query.page - 1) * query.page_size + 1;
  const endIndex = Math.min(
    query.page * query.page_size,
    followUpsResponse.total,
  );

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Follow-Ups</h1>
          <Link href="/" className="text-sm text-blue-700 hover:underline">
            {"<- Home"}
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
              action="/follow-ups"
            >
              <input type="hidden" name="page" value="1" />
              <input
                type="hidden"
                name="page_size"
                value={String(query.page_size)}
              />
              <label className="text-xs font-medium">
                Entity
                <select
                  name="entity"
                  defaultValue={query.entity ?? ""}
                  className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                >
                  <option value="">All</option>
                  <option value="ALL">ALL</option>
                  <option value="IND">IND</option>
                  <option value="UAE">UAE</option>
                </select>
              </label>
              <label className="text-xs font-medium">
                Channel
                <select
                  name="channel"
                  defaultValue={query.channel ?? ""}
                  className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                >
                  <option value="">All</option>
                  <option value="EMAIL">EMAIL</option>
                  <option value="CALL">CALL</option>
                  <option value="WHATSAPP">WHATSAPP</option>
                  <option value="MEETING">MEETING</option>
                </select>
              </label>
              <label className="text-xs font-medium">
                Canonical ID
                <input
                  name="canonical_id"
                  defaultValue={query.canonical_id ?? ""}
                  className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                  placeholder="UUID"
                />
              </label>
              <label className="text-xs font-medium">
                Invoice ID
                <input
                  name="invoice_id"
                  defaultValue={query.invoice_id ?? ""}
                  className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                  placeholder="UUID"
                />
              </label>
              <label className="text-xs font-medium">
                Page size
                <input
                  name="page_size"
                  defaultValue={query.page_size}
                  type="number"
                  min={1}
                  max={200}
                  className="mt-1 block w-full rounded border border-slate-200 px-2 py-2 text-sm"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="h-10 rounded bg-slate-900 px-4 text-sm text-white hover:bg-slate-800"
                >
                  Apply
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-Up Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            {followUpsResponse.items.length === 0 ? (
              <p className="text-sm text-slate-500">
                {currentUser
                  ? "No follow-ups found for the selected filters."
                  : "Sign in to view follow-ups."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Party</th>
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2">Channel</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Next Action</th>
                      <th className="px-3 py-2">Notes</th>
                      <th className="px-3 py-2">Logged By</th>
                      <th className="px-3 py-2">Logged At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {followUpsResponse.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">{formatDate(item.date)}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/party/${item.canonical_id}`}
                            className="text-blue-700 hover:underline"
                          >
                            {item.canonical_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {item.invoice_id ? (
                            <Link
                              href={`/invoice/${item.invoice_id}`}
                              className="text-blue-700 hover:underline"
                            >
                              {item.invoice_ref ?? "View"}
                            </Link>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="px-3 py-2">{item.channel}</td>
                        <td className="px-3 py-2">
                          {item.contact_person ?? "-"}
                        </td>
                        <td className="px-3 py-2">
                          {item.next_action_date
                            ? formatDate(item.next_action_date)
                            : "-"}
                        </td>
                        <td className="max-w-[220px] px-3 py-2">
                          {item.notes ?? "-"}
                        </td>
                        <td className="px-3 py-2">{item.logged_by_email}</td>
                        <td className="px-3 py-2">
                          {formatDateTime(item.logged_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Showing {startIndex}-{endIndex} of {followUpsResponse.total}
              </span>
              <div className="flex gap-2">
                {query.page > 1 ? (
                  <Link
                    href={buildPageHref(query, query.page - 1)}
                    className="rounded border border-slate-200 px-3 py-1"
                  >
                    Prev
                  </Link>
                ) : null}
                <span className="rounded border border-slate-200 px-3 py-1">
                  {query.page} / {totalPages}
                </span>
                {query.page < totalPages ? (
                  <Link
                    href={buildPageHref(query, query.page + 1)}
                    className="rounded border border-slate-200 px-3 py-1"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New Follow-Up</CardTitle>
          </CardHeader>
          <CardContent>
            {canCreate ? (
              <CreateFollowUpForm
                defaultCanonicalId={query.canonical_id ?? ""}
                defaultInvoiceId={query.invoice_id ?? ""}
              />
            ) : (
              <p className="text-sm text-slate-500">
                You do not have permission to create follow-ups.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
