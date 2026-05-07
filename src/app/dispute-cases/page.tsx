import Link from "next/link";
import { ArrowRight, Filter } from "lucide-react";
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
import type { dispute_case_status } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { assertNotPending } from "@/server/core/assertNotPending";
import { requirePageRole } from "@/server/core/page-auth";
import { listDisputeCases } from "@/server/dispute-cases/service";
import { DisputeKanban } from "./_components/dispute-kanban";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type DisputePageParams = {
  dispute?: string;
  entity_id?: string;
  page?: number;
  status?: dispute_case_status;
  tab?: DisputePageTab;
};

type DisputePageTab = "list" | "kanban";

type DisputeRow = {
  canonical_id: string;
  created_at: Date;
  description: string;
  entities?: { code?: string | null } | null;
  entity_id: string;
  expected_resolution_date: Date | null;
  id: string;
  invoice_id: string | null;
  owner_user_id: string | null;
  parties_canonical?: { name?: string | null } | null;
  reason_code: string;
  status: dispute_case_status;
  updated_at: Date;
};

const STATUS_FILTERS: { label: string; value: dispute_case_status | "" }[] = [
  { label: "All", value: "" },
  { label: "Open", value: "OPEN" },
  { label: "Investigating", value: "IN_REVIEW" },
  { label: "Escalated", value: "WAITING_ON_CUSTOMER" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Cancelled", value: "CLOSED" },
];

const VIEW_TABS: Array<{ label: string; value: DisputePageTab }> = [
  { label: "List", value: "list" },
  { label: "Kanban", value: "kanban" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : "-";
}

function truncate(value: string, max = 80) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function ownerLabel(ownerUserId: string | null) {
  return ownerUserId ? shortId(ownerUserId) : "Unassigned";
}

function disputeStatusMeta(status: dispute_case_status) {
  if (status === "IN_REVIEW") {
    return { label: "Investigating", status: "DISPUTE_IN_REVIEW" };
  }
  if (status === "WAITING_ON_CUSTOMER") {
    return { label: "Escalated", status: "DISPUTE_WAITING_ON_CUSTOMER" };
  }
  if (status === "CLOSED") {
    return { label: "Cancelled", status: "DISPUTE_CLOSED" };
  }
  return { label: undefined, status: `DISPUTE_${status}` };
}

function disputeHref(params: DisputePageParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `/dispute-cases?${query}` : "/dispute-cases";
}

function previewHref(disputeId: string, params: DisputePageParams) {
  return disputeHref({ ...params, dispute: disputeId, page: 1 });
}

function fullRecordHref(dispute: DisputeRow) {
  return dispute.invoice_id
    ? `/invoice/${dispute.invoice_id}`
    : `/party/${dispute.canonical_id}`;
}

function nextActionLabel(dispute: DisputeRow) {
  if (dispute.invoice_id) return "Open linked invoice";
  return "Open party record";
}

function disputeColumns(
  params: DisputePageParams,
): DataTableColumn<DisputeRow>[] {
  return [
    {
      key: "invoice",
      header: "Invoice",
      sticky: "left",
      width: "min-w-[160px]",
      cell: (dispute) =>
        dispute.invoice_id ? (
          // TODO: Replace this invoice_id preview with invoice_ref when listDisputeCases exposes it.
          <Link
            className="font-mono text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
            href={`/invoice/${dispute.invoice_id}`}
          >
            {shortId(dispute.invoice_id)}
          </Link>
        ) : (
          <span className="font-mono text-[13px] text-[var(--color-text-muted)]">
            No invoice
          </span>
        ),
    },
    {
      key: "party",
      header: "Party",
      sticky: "left",
      width: "min-w-[240px]",
      cell: (dispute) => (
        <div>
          <Link
            className="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
            href={`/party/${dispute.canonical_id}`}
          >
            {dispute.parties_canonical?.name ?? "Unmatched account"}
          </Link>
          <div className="text-xs text-[var(--color-text-muted)]">
            {dispute.entities?.code ?? dispute.entity_id}
          </div>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Reason Code",
      cell: (dispute) => (
        <span className="font-mono text-xs text-[var(--color-text-muted)]">
          {dispute.reason_code}
        </span>
      ),
    },
    {
      key: "status",
      header: "Dispute Status",
      cell: (dispute) => {
        const tag = disputeStatusMeta(dispute.status);
        return <StatusTag label={tag.label} status={tag.status} />;
      },
    },
    {
      key: "expected",
      header: "Expected Resolution",
      cell: (dispute) => (
        <span className="text-[var(--color-text-muted)]">
          {formatDate(dispute.expected_resolution_date)}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      cell: (dispute) => (
        <span className="text-[var(--color-text-muted)]">
          {ownerLabel(dispute.owner_user_id)}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (dispute) => (
        <span className="text-[var(--color-text-subtle)]">
          {formatDate(dispute.created_at)}
        </span>
      ),
    },
    {
      key: "summary",
      header: "Summary",
      width: "min-w-[240px]",
      cell: (dispute) => (
        <Link
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
          href={previewHref(dispute.id, params)}
        >
          {truncate(dispute.description)}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ),
    },
  ];
}

export default async function DisputeCasesPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const user = await requirePageRole(
    "/dispute-cases",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const page = Number(first(raw.page) ?? "1");
  const activeTab: DisputePageTab =
    first(raw.tab) === "kanban" ? "kanban" : "list";
  const params: DisputePageParams = {
    dispute: first(raw.dispute),
    entity_id: first(raw.entity_id),
    page,
    status: first(raw.status) as dispute_case_status | undefined,
    tab: activeTab === "kanban" ? "kanban" : undefined,
  };

  const { items, page_size: pageSize, total } = await listDisputeCases(
    {
      entity_id: params.entity_id,
      page,
      status: params.status,
    },
    user,
  );

  const disputes = items as DisputeRow[];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFiltered = Boolean(params.status) || Boolean(params.entity_id);
  const selected =
    disputes.find((dispute) => dispute.id === params.dispute) ??
    disputes[0] ??
    null;
  const activeCount = disputes.filter((dispute) =>
    ["OPEN", "IN_REVIEW", "WAITING_ON_CUSTOMER"].includes(dispute.status),
  ).length;
  const escalatedCount = disputes.filter(
    (dispute) => dispute.status === "WAITING_ON_CUSTOMER",
  ).length;
  const resolvedCount = disputes.filter(
    (dispute) => dispute.status === "RESOLVED",
  ).length;
  const kanbanDisputes = disputes.map((dispute) => ({
    canonical_id: dispute.canonical_id,
    entity_code: dispute.entities?.code ?? dispute.entity_id,
    id: dispute.id,
    party_name: dispute.parties_canonical?.name ?? "Unmatched account",
    reason_code: dispute.reason_code,
    status: dispute.status,
  }));

  return (
    <PageFrame>
      <PageHeader title="Dispute Cases">
        Track customer disputes, owners, expected resolution dates, and linked
        invoice context.
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Cases" meta="Current view" value={total} />
        <MetricCard
          label="Active"
          meta="Open, investigating, or escalated"
          value={activeCount}
        />
        <MetricCard
          label="Escalated"
          meta="Waiting on customer or manager review"
          value={escalatedCount}
        />
        <MetricCard
          label="Resolved"
          meta="Closed with resolution path"
          value={resolvedCount}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewTabs>
            {STATUS_FILTERS.map(({ label, value }) => (
              <SavedViewLink
                active={(params.status ?? "") === value}
                href={disputeHref({
                  entity_id: params.entity_id,
                  status: value || undefined,
                  tab: params.tab,
                })}
                key={value || "all"}
              >
                {label}
              </SavedViewLink>
            ))}
          </SavedViewTabs>

          <div className="inline-flex w-fit items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm">
            {VIEW_TABS.map((tab) => {
              const active = activeTab === tab.value;

              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={[
                    "rounded-[var(--radius-sm)] px-3 py-1.5 font-medium text-[var(--color-text-muted)] transition",
                    active
                      ? "bg-[var(--color-bg-subtle)] text-[var(--color-text)] shadow-sm"
                      : "hover:text-[var(--color-text)]",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  href={disputeHref({
                    ...params,
                    page: 1,
                    tab: tab.value === "kanban" ? "kanban" : undefined,
                  })}
                  key={tab.value}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          <Panel>
            <form
              action="/dispute-cases"
              className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-sm"
            >
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
              {params.tab ? (
                <input name="tab" type="hidden" value={params.tab} />
              ) : null}
              {params.entity_id ? (
                <input name="entity_id" type="hidden" value={params.entity_id} />
              ) : null}
              <Button type="submit" variant="secondary">
                <Filter className="h-4 w-4" />
                Apply Filters
              </Button>
            </form>

            {activeTab === "kanban" ? (
              <DisputeKanban disputes={kanbanDisputes} />
            ) : null}

            {activeTab !== "kanban" ? (
              <>
                <DataTable<DisputeRow>
                  columns={disputeColumns(params)}
                  emptyState={{
                    title: "No dispute cases yet",
                    description:
                      "Disputes appear here after analysts raise them from collection tasks or invoice detail pages.",
                    action: (
                      <Link
                        className="text-sm font-medium text-[var(--color-accent)]"
                        href="/tasks"
                      >
                        Review task queue
                      </Link>
                    ),
                  }}
                  filteredEmptyState={{
                    title: "No disputes match this filter",
                    description:
                      "Switch the lifecycle filter or clear entity scope to inspect other cases.",
                    action: (
                      <Link
                        className="text-sm font-medium text-[var(--color-accent)]"
                        href="/dispute-cases"
                      >
                        Clear filters
                      </Link>
                    ),
                  }}
                  isFiltered={isFiltered}
                  minWidthClass="min-w-[1180px]"
                  rowHref={(dispute) => previewHref(dispute.id, params)}
                  rowKey={(dispute) => dispute.id}
                  rows={disputes}
                  selectedRowKey={selected?.id ?? null}
                />

                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                  <span>
                    Showing page {page} of {totalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <Link
                      aria-disabled={page <= 1}
                      className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                      href={disputeHref({
                        ...params,
                        page: Math.max(1, page - 1),
                      })}
                    >
                      Previous
                    </Link>
                    <Link
                      aria-disabled={page >= totalPages}
                      className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                      href={disputeHref({
                        ...params,
                        page: Math.min(totalPages, page + 1),
                      })}
                    >
                      Next
                    </Link>
                  </div>
                </div>
              </>
            ) : null}
          </Panel>
        </div>

        <RightRail>
          {selected ? (
            <SidePanel
              meta={`Created ${formatDate(selected.created_at)} - updated ${formatDate(selected.updated_at)}`}
              nextAction={
                <Link
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                  href={fullRecordHref(selected)}
                >
                  {nextActionLabel(selected)}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              }
              openFullPageHref={fullRecordHref(selected)}
              status={
                <StatusTag
                  label={disputeStatusMeta(selected.status).label}
                  status={disputeStatusMeta(selected.status).status}
                />
              }
              subtitle={selected.parties_canonical?.name ?? selected.canonical_id}
              title={`Dispute ${shortId(selected.id)}`}
            >
              <div className="grid grid-cols-2 gap-3">
                <SidePanelField label="Invoice">
                  {selected.invoice_id ? shortId(selected.invoice_id) : "No invoice"}
                </SidePanelField>
                <SidePanelField label="Reason">
                  <span className="font-mono text-xs">{selected.reason_code}</span>
                </SidePanelField>
                <SidePanelField label="Expected Resolution">
                  {formatDate(selected.expected_resolution_date)}
                </SidePanelField>
                <SidePanelField label="Owner">
                  {ownerLabel(selected.owner_user_id)}
                </SidePanelField>
              </div>

              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Case Summary
                </div>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  {selected.description}
                </p>
              </div>
            </SidePanel>
          ) : (
            <SidePanel title="No case selected">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a dispute row to inspect ownership, expected resolution,
                and linked record context.
              </p>
            </SidePanel>
          )}
        </RightRail>
      </div>
    </PageFrame>
  );
}
