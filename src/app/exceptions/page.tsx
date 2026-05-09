import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  SavedViewLink,
  SavedViewTabs,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatDate, formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import {
  exceptionListFiltersSchema,
  listExceptions,
} from "@/server/exceptions/service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ExceptionRow = {
  id: string;
  invoice_id: string;
  invoice_ref: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  bucket_type_name: string;
  reason: string | null;
  tagged_by_email: string;
  tagged_at: string;
  expected_resolution_date: string | null;
  status: string;
};

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "Active", value: "ACTIVE" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Auto-resolved", value: "AUTO_RESOLVED" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function exceptionStatusTag(status: string) {
  if (status === "ACTIVE") return "EXCEPTION_ACTIVE";
  if (status === "RESOLVED") return "EXCEPTION_RESOLVED";
  return "NO_DATA";
}

function pageHref(page: number, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, page: String(page) })) {
    if (value) search.set(key, value);
  }
  return `/exceptions?${search.toString()}`;
}

function exceptionsColumns(): DataTableColumn<ExceptionRow>[] {
  return [
    {
      key: "invoice",
      header: "Invoice",
      sticky: "left",
      width: "min-w-[140px]",
      cell: (row) => (
        <Link
          className="font-mono text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
          href={`/invoice/${row.invoice_id}`}
        >
          {row.invoice_ref}
        </Link>
      ),
    },
    {
      key: "party",
      header: "Party",
      sticky: "left",
      width: "min-w-[200px]",
      cell: (row) => (
        <div>
          <Link
            className="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
            href={`/party/${row.canonical_id}`}
          >
            {row.canonical_name}
          </Link>
          <div className="text-xs text-[var(--color-text-muted)]">{row.entity_code}</div>
        </div>
      ),
    },
    {
      key: "bucket",
      header: "Bucket",
      cell: (row) => (
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {row.bucket_type_name}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      width: "min-w-[220px]",
      cell: (row) => (
        <span className="text-[var(--color-text-muted)]">{row.reason ?? "-"}</span>
      ),
    },
    {
      key: "tagged",
      header: "Tagged",
      cell: (row) => (
        <div>
          <div className="text-[var(--color-text-muted)]">{row.tagged_by_email}</div>
          <div className="text-xs text-[var(--color-text-subtle)]">{formatDateTime(row.tagged_at)}</div>
        </div>
      ),
    },
    {
      key: "expected",
      header: "Expected Resolution",
      cell: (row) => (
        <span className="text-[var(--color-text-muted)]">
          {formatDate(row.expected_resolution_date)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusTag status={exceptionStatusTag(row.status)} label={row.status} />,
    },
  ];
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
  const totalPages = Math.max(1, Math.ceil(response.total / response.page_size));
  const isFiltered = Boolean(params.status) || Boolean(params.entity) || Boolean(params.bucket_type);
  const activeCount = response.items.filter((i) => i.status === "ACTIVE").length;
  const resolvedCount = response.items.filter((i) => i.status === "RESOLVED").length;

  return (
    <PageFrame>
      <PageHeader title="Exceptions">
        Control exceptions tagged against invoices — ageing, policy, or data
        quality signals that need resolution.
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total" meta="Current filter" value={response.total} />
        <MetricCard label="Active" meta="Needs analyst action" value={activeCount} />
        <MetricCard label="Resolved" meta="Closed with resolution" value={resolvedCount} />
        <MetricCard label="Page" meta={`of ${totalPages}`} value={response.page} />
      </section>

      <Panel>
        <SavedViewTabs>
          {STATUS_FILTERS.map(({ label, value }) => (
            <SavedViewLink
              active={(params.status ?? "") === value}
              href={`/exceptions?${value ? `status=${value}&` : ""}page=1`}
              key={value || "all"}
            >
              {label}
            </SavedViewLink>
          ))}
        </SavedViewTabs>

        <DataTable<ExceptionRow>
          columns={exceptionsColumns()}
          emptyState={{
            title: "No exceptions tagged",
            description:
              "Exception tags appear when analysts flag invoices for ageing, policy, or data-quality issues.",
            action: (
              <Link className="text-sm font-medium text-[var(--color-accent)]" href="/invoices">
                Browse invoices
              </Link>
            ),
          }}
          filteredEmptyState={{
            title: "No exceptions match this filter",
            description: "Try switching the status filter or clearing entity scope.",
            action: (
              <Link className="text-sm font-medium text-[var(--color-accent)]" href="/exceptions">
                Clear filters
              </Link>
            ),
          }}
          isFiltered={isFiltered}
          minWidthClass="min-w-[1100px]"
          rowKey={(row) => row.id}
          rows={response.items as ExceptionRow[]}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text-muted)]">
          <span>Page {response.page} of {totalPages}</span>
          <div className="flex gap-2">
            <Link
              aria-disabled={response.page <= 1}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={pageHref(Math.max(1, response.page - 1), params)}
            >
              Previous
            </Link>
            <Link
              aria-disabled={response.page >= totalPages}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
              href={pageHref(Math.min(totalPages, response.page + 1), params)}
            >
              Next
            </Link>
          </div>
        </div>
      </Panel>
    </PageFrame>
  );
}
