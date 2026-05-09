import Link from "next/link";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import {
  listFollowUps,
  parseFollowUpListQuery,
} from "@/server/follow-ups/service";
import CreateFollowUpForm from "./_components/create-follow-up-form";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type FollowUpRow = {
  id: string;
  date: string;
  canonical_id: string;
  canonical_name: string;
  invoice_id: string | null;
  invoice_ref: string | null;
  channel: string;
  contact_person: string | null;
  next_action_date: string | null;
  notes: string | null;
  logged_by_email: string;
  logged_at: string;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function channelTag(channel: string) {
  if (channel === "EMAIL") return "FOLLOW_UP_DUE";
  if (channel === "CALL") return "TASK_IN_PROGRESS";
  if (channel === "WHATSAPP") return "TASK_OPEN";
  return "NO_DATA";
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

function followUpColumns(): DataTableColumn<FollowUpRow>[] {
  return [
    {
      key: "date",
      header: "Date",
      width: "min-w-[120px]",
      cell: (row) => (
        <span className="text-[var(--color-text-muted)]">{formatDate(row.date)}</span>
      ),
    },
    {
      key: "party",
      header: "Party",
      sticky: "left",
      width: "min-w-[200px]",
      cell: (row) => (
        <Link
          className="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
          href={`/party/${row.canonical_id}`}
        >
          {row.canonical_name}
        </Link>
      ),
    },
    {
      key: "invoice",
      header: "Invoice",
      cell: (row) =>
        row.invoice_id ? (
          <Link
            className="font-mono text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
            href={`/invoice/${row.invoice_id}`}
          >
            {row.invoice_ref ?? "View"}
          </Link>
        ) : (
          <span className="text-[var(--color-text-muted)]">-</span>
        ),
    },
    {
      key: "channel",
      header: "Channel",
      cell: (row) => (
        <StatusTag label={row.channel} status={channelTag(row.channel)} />
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <span className="text-[var(--color-text-muted)]">{row.contact_person ?? "-"}</span>
      ),
    },
    {
      key: "next_action",
      header: "Next Action",
      cell: (row) => (
        <span className="text-[var(--color-text-muted)]">
          {row.next_action_date ? formatDate(row.next_action_date) : "-"}
        </span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      width: "min-w-[200px]",
      cell: (row) => (
        <span className="text-[var(--color-text-muted)]">{row.notes ?? "-"}</span>
      ),
    },
    {
      key: "logged",
      header: "Logged",
      cell: (row) => (
        <div>
          <div className="text-[var(--color-text-muted)]">{row.logged_by_email}</div>
          <div className="text-xs text-[var(--color-text-subtle)]">{formatDateTime(row.logged_at)}</div>
        </div>
      ),
    },
  ];
}

export default async function FollowUpsPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/follow-ups",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );

  const resolvedSearchParams = ((await Promise.resolve(searchParams || {})) as Record<
    string,
    string | string[] | undefined
  >);

  const query = parseFollowUpListQuery({
    entity: first(resolvedSearchParams.entity),
    channel: first(resolvedSearchParams.channel),
    canonical_id: first(resolvedSearchParams.canonical_id),
    invoice_id: first(resolvedSearchParams.invoice_id),
    page: first(resolvedSearchParams.page),
    page_size: first(resolvedSearchParams.page_size),
  });

  const followUpsResponse = await listFollowUps(query, currentUser);

  const totalPages = Math.max(1, Math.ceil(followUpsResponse.total / followUpsResponse.page_size));
  const canCreate =
    currentUser.role === role_enum.ANALYST || currentUser.role === role_enum.ADMIN;
  const startIndex = followUpsResponse.total === 0 ? 0 : (query.page - 1) * query.page_size + 1;
  const endIndex = Math.min(query.page * query.page_size, followUpsResponse.total);
  const isFiltered = Boolean(query.entity) || Boolean(query.channel) || Boolean(query.canonical_id) || Boolean(query.invoice_id);

  return (
    <PageFrame>
      <PageHeader title="Follow-Ups">
        Outreach timeline — calls, emails, and WhatsApp contacts logged against
        parties and invoices.
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Total Follow-Ups" meta="Current filter" value={followUpsResponse.total} />
        <MetricCard label="Showing" meta={`records ${startIndex}–${endIndex}`} value={endIndex - startIndex + (followUpsResponse.total > 0 ? 1 : 0)} />
        <MetricCard label="Page" meta={`of ${totalPages}`} value={query.page} />
      </section>

      <Panel>
        <form action="/follow-ups" className="flex flex-wrap items-end gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-sm">
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="page_size" value={String(query.page_size)} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Entity</label>
            <select
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text)]"
              defaultValue={query.entity ?? ""}
              name="entity"
            >
              <option value="">All</option>
              <option value="IND">India</option>
              <option value="UAE">UAE</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Channel</label>
            <select
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text)]"
              defaultValue={query.channel ?? ""}
              name="channel"
            >
              <option value="">All</option>
              <option value="EMAIL">Email</option>
              <option value="CALL">Call</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="MEETING">Meeting</option>
            </select>
          </div>
          <Button type="submit" variant="secondary">
            <Filter className="h-4 w-4" />
            Apply
          </Button>
          {isFiltered && (
            <Link
              className="inline-flex h-9 items-center px-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              href="/follow-ups"
            >
              Clear
            </Link>
          )}
        </form>

        <DataTable<FollowUpRow>
          columns={followUpColumns()}
          emptyState={{
            title: "No follow-ups yet",
            description:
              "Log outreach activity against a party or invoice to build the contact timeline.",
          }}
          filteredEmptyState={{
            title: "No follow-ups match these filters",
            description: "Try clearing channel or entity filters.",
            action: (
              <Link className="text-sm font-medium text-[var(--color-accent)]" href="/follow-ups">
                Clear filters
              </Link>
            ),
          }}
          isFiltered={isFiltered}
          minWidthClass="min-w-[1120px]"
          rowKey={(row) => row.id}
          rows={followUpsResponse.items as FollowUpRow[]}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text-muted)]">
          <span>Showing {startIndex}–{endIndex} of {followUpsResponse.total}</span>
          <div className="flex gap-2">
            <Link
              aria-disabled={query.page <= 1}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={buildPageHref(query, Math.max(1, query.page - 1))}
            >
              Previous
            </Link>
            <Link
              aria-disabled={query.page >= totalPages}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={buildPageHref(query, Math.min(totalPages, query.page + 1))}
            >
              Next
            </Link>
          </div>
        </div>
      </Panel>

      {canCreate && (
        <Panel>
          <PanelHeader title="Log New Follow-Up">
            Record outreach activity against a party or invoice.
          </PanelHeader>
          <div className="p-4">
            <CreateFollowUpForm
              defaultCanonicalId={query.canonical_id ?? ""}
              defaultInvoiceId={query.invoice_id ?? ""}
            />
          </div>
        </Panel>
      )}
    </PageFrame>
  );
}
