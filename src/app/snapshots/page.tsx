import Link from "next/link";
import { ArrowRight, Filter, Layers, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { SidePanel, SidePanelField } from "@/components/ui/side-panel";
import { StatusTag } from "@/components/ui/status-tag";
import {
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  RightRail,
  SavedViewLink,
  SavedViewTabs,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import {
  listSnapshots,
  snapshotListFiltersSchema,
} from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type SnapshotPageParams = {
  entity_code?: string;
  page?: number;
  page_size: number;
  snapshot?: string;
  status?: string;
};

type SnapshotRow = {
  as_of_date: string | null;
  entity_code: string;
  id: string;
  row_count: number | null;
  source_hint: string;
  status: string;
  total_outstanding: string | null;
  uploaded_at: string;
  uploaded_by_email: string;
  warnings_count?: number | null;
};

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "" },
  { label: "Uploaded", value: "UPLOADED" },
  { label: "Staged", value: "STAGED" },
  { label: "Published", value: "PUBLISHED" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Failed", value: "FAILED" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function statusFilterValues(value: string | undefined): string[] | undefined {
  if (!value) return undefined;

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => (item === "REJECTED" ? ["REJECTED", "DISCARDED"] : [item]));
}

function snapshotHref(params: SnapshotPageParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `/snapshots?${query}` : "/snapshots";
}

function previewHref(snapshotId: string, params: SnapshotPageParams) {
  return snapshotHref({ ...params, page: 1, snapshot: snapshotId });
}

function sourceLabel(sourceHint: string) {
  if (sourceHint === "CREDIT_PERIOD") return "Credit Period";
  return sourceHint.charAt(0).toUpperCase() + sourceHint.slice(1).toLowerCase();
}

function snapshotStatusMeta(status: string) {
  if (status === "DISCARDED") {
    return { label: "Rejected", status: "REJECTED" };
  }
  return { label: undefined, status };
}

function currencyFor(snapshot: SnapshotRow) {
  return snapshot.entity_code === "IND" ? "INR" : "AED";
}

function warningCount(snapshot: SnapshotRow) {
  return typeof snapshot.warnings_count === "number"
    ? snapshot.warnings_count
    : "-";
}

function nextActionForSnapshot(snapshot: SnapshotRow) {
  if (snapshot.status === "STAGED" || snapshot.status === "UPLOADED") {
    return {
      href: `/snapshots/${snapshot.id}/staging`,
      label: "Review upload",
    };
  }

  return {
    href: `/snapshots/${snapshot.id}`,
    label: "Open snapshot",
  };
}

function snapshotColumns(): DataTableColumn<SnapshotRow>[] {
  return [
    {
      key: "snapshot",
      header: "Snapshot",
      sticky: "left",
      width: "min-w-[180px]",
      cell: (snapshot) => (
        <div>
          <span className="font-mono text-[13px] font-semibold text-[var(--color-accent)]">
            {snapshot.id.slice(0, 8)}
          </span>
          <div className="text-xs text-[var(--color-text-muted)]">
            {formatDate(snapshot.as_of_date)}
          </div>
        </div>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      sticky: "left",
      width: "min-w-[100px]",
      cell: (snapshot) => (
        <span className="font-medium text-[var(--color-text)]">
          {snapshot.entity_code}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      cell: (snapshot) => (
        <span className="text-[var(--color-text-muted)]">
          {sourceLabel(snapshot.source_hint)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (snapshot) => {
        const tag = snapshotStatusMeta(snapshot.status);
        return <StatusTag label={tag.label} status={tag.status} />;
      },
    },
    {
      key: "uploaded_by",
      header: "Uploaded By",
      cell: (snapshot) => (
        <span className="text-[var(--color-text-muted)]">
          {snapshot.uploaded_by_email}
        </span>
      ),
    },
    {
      key: "uploaded_at",
      header: "Uploaded",
      cell: (snapshot) => (
        <span className="text-[var(--color-text-muted)]">
          {formatDateTime(snapshot.uploaded_at)}
        </span>
      ),
    },
    {
      key: "rows",
      header: "Rows",
      align: "right",
      cell: (snapshot) => snapshot.row_count ?? "-",
    },
    {
      key: "warnings",
      header: "Warnings",
      align: "right",
      cell: (snapshot) => warningCount(snapshot),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      cell: (snapshot) => (
        <span className="font-medium tabular-nums">
          {snapshot.total_outstanding
            ? formatCurrency(snapshot.total_outstanding, currencyFor(snapshot))
            : "-"}
        </span>
      ),
    },
    {
      key: "next",
      header: "Next Action",
      cell: (snapshot) => {
        const action = nextActionForSnapshot(snapshot);
        return (
          <Link
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
            href={action.href}
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        );
      },
    },
  ];
}

export default async function SnapshotsPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/snapshots",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  const raw = await searchParams;
  const page = Number(first(raw.page) ?? "1");
  const pageSize = Number(first(raw.page_size) ?? "50");
  const params: SnapshotPageParams = {
    entity_code: first(raw.entity_code),
    page,
    page_size: pageSize,
    snapshot: first(raw.snapshot),
    status: first(raw.status),
  };
  const filters = snapshotListFiltersSchema.parse({
    entity_code: params.entity_code,
    page,
    page_size: pageSize,
    status: statusFilterValues(params.status),
  });
  const response = await listSnapshots(filters, currentUser);
  const snapshots = response.items as SnapshotRow[];
  const totalPages = Math.max(
    1,
    Math.ceil(response.total / response.page_size),
  );
  const isFiltered = Boolean(params.entity_code) || Boolean(params.status);
  const selected =
    snapshots.find((snapshot) => snapshot.id === params.snapshot) ??
    snapshots[0] ??
    null;
  const stagedCount = snapshots.filter(
    (snapshot) => snapshot.status === "STAGED",
  ).length;
  const publishedCount = snapshots.filter(
    (snapshot) => snapshot.status === "PUBLISHED",
  ).length;
  const warningTotal = snapshots.reduce((sum, snapshot) => {
    const count = snapshot.warnings_count;
    return sum + (typeof count === "number" ? count : 0);
  }, 0);

  function statusViewHref(value: string) {
    return snapshotHref({
      entity_code: params.entity_code,
      page_size: params.page_size,
      status: value || undefined,
    });
  }

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)]"
            href="/upload"
          >
            <Upload className="h-4 w-4" />
            Upload Snapshot
          </Link>
        }
        title="Snapshots"
      >
        Upload, stage, validate, and publish AR workbooks.
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total" meta="Visible snapshots" value={response.total} />
        <MetricCard label="Staged" meta="Awaiting review" value={stagedCount} />
        <MetricCard
          label="Published"
          meta="Available for ageing and reconciliation"
          value={publishedCount}
        />
        <MetricCard
          label="Warnings"
          meta="Visible page warning total"
          value={warningTotal}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewTabs>
            {STATUS_FILTERS.map(({ label, value }) => (
              <SavedViewLink
                active={(params.status ?? "") === value}
                href={statusViewHref(value)}
                key={value || "all"}
              >
                {label}
              </SavedViewLink>
            ))}
          </SavedViewTabs>

          <Panel>
            <form
              action="/snapshots"
              className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-sm"
            >
              <select
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text)]"
                defaultValue={params.entity_code ?? ""}
                name="entity_code"
              >
                <option value="">All entities</option>
                <option value="IND">IND</option>
                <option value="UAE">UAE</option>
              </select>
              <select
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text)]"
                defaultValue={params.status ?? ""}
                name="status"
              >
                {STATUS_FILTERS.map((filter) => (
                  <option key={filter.value || "all"} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </select>
              <input name="page" type="hidden" value="1" />
              <input name="page_size" type="hidden" value={pageSize} />
              <Button type="submit" variant="secondary">
                <Filter className="h-4 w-4" />
                Apply Filters
              </Button>
            </form>

            <DataTable<SnapshotRow>
              columns={snapshotColumns()}
              emptyState={{
                icon: <Layers className="h-6 w-6" />,
                title: "No snapshots yet",
                description:
                  "Upload your first Tally or Xero AR workbook to start the staging → review → publish flow. The snapshot lands here once parsed.",
                action: (
                  <Link
                    className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)]"
                    href="/upload"
                  >
                    <Upload className="h-4 w-4" />
                    Upload your first workbook
                  </Link>
                ),
              }}
              filteredEmptyState={{
                icon: <Filter className="h-6 w-6" />,
                title: "Nothing matches this filter",
                description:
                  "Try switching the entity or lifecycle status, or clear filters to see every snapshot you've uploaded.",
                action: (
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href="/snapshots"
                  >
                    Clear filters
                  </Link>
                ),
              }}
              isFiltered={isFiltered}
              minWidthClass="min-w-[1240px]"
              rowHref={(snapshot) => previewHref(snapshot.id, params)}
              rowKey={(snapshot) => snapshot.id}
              rows={snapshots}
              selectedRowKey={selected?.id ?? null}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text-muted)]">
              <span>
                Showing page {response.page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Link
                  aria-disabled={response.page <= 1}
                  className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  href={snapshotHref({
                    ...params,
                    page: Math.max(1, response.page - 1),
                  })}
                >
                  Previous
                </Link>
                <Link
                  aria-disabled={response.page >= totalPages}
                  className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  href={snapshotHref({
                    ...params,
                    page: Math.min(totalPages, response.page + 1),
                  })}
                >
                  Next
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        <RightRail>
          {selected ? (
            <SidePanel
              meta={`Uploaded ${formatDateTime(selected.uploaded_at)} by ${selected.uploaded_by_email}`}
              nextAction={
                <Link
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                  href={nextActionForSnapshot(selected).href}
                >
                  {nextActionForSnapshot(selected).label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              }
              openFullPageHref={`/snapshots/${selected.id}`}
              status={
                <StatusTag
                  label={snapshotStatusMeta(selected.status).label}
                  status={snapshotStatusMeta(selected.status).status}
                />
              }
              subtitle={`${selected.entity_code} - ${sourceLabel(selected.source_hint)}`}
              title={`Snapshot ${selected.id.slice(0, 8)}`}
            >
              <div className="grid grid-cols-2 gap-3">
                <SidePanelField label="As Of">
                  {formatDate(selected.as_of_date)}
                </SidePanelField>
                <SidePanelField label="Rows">
                  {selected.row_count ?? "-"}
                </SidePanelField>
                <SidePanelField label="Warnings">
                  {warningCount(selected)}
                </SidePanelField>
                <SidePanelField label="Outstanding">
                  {selected.total_outstanding
                    ? formatCurrency(selected.total_outstanding, currencyFor(selected))
                    : "-"}
                </SidePanelField>
              </div>

              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Next Review Path
                </div>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  Open the snapshot record to inspect staging, reconciliation,
                  publish state, and upload metadata.
                </p>
              </div>
            </SidePanel>
          ) : (
            <SidePanel title="No snapshot selected">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a snapshot row to inspect the upload, status, and
                as-of date.
              </p>
            </SidePanel>
          )}
        </RightRail>
      </div>
    </PageFrame>
  );
}
