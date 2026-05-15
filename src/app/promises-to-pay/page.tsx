import Link from "next/link";
import { ArrowRight, CalendarCheck, ListChecks } from "lucide-react";
import { PtpCalendar } from "@/app/promises-to-pay/_components/ptp-calendar";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { SidePanel, SidePanelField } from "@/components/ui/side-panel";
import { StatusTag } from "@/components/ui/status-tag";
import {
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
  SavedViewLink,
  SavedViewTabs,
} from "@/components/ui/workspace";
import { promise_to_pay_status, role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { assertNotPending } from "@/server/core/assertNotPending";
import { requirePageRole } from "@/server/core/page-auth";
import { listPromisesToPay } from "@/server/promises-to-pay/service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PromiseStatus = promise_to_pay_status;
type PromiseTab = "list" | "calendar";
type PromiseListResponse = Awaited<ReturnType<typeof listPromisesToPay>>;
type PromiseListItem = PromiseListResponse["items"][number];
type PromiseViewRow = PromiseListItem & {
  invoice_ref: string | null;
  party_name: string;
};

type PromisePageParams = {
  canonical_id?: string;
  page: number;
  promise?: string;
  status?: PromiseStatus;
  tab?: PromiseTab;
};

const STATUS_FILTERS: { label: string; value: PromiseStatus | "" }[] = [
  { label: "All", value: "" },
  { label: "Open", value: promise_to_pay_status.OPEN },
  { label: "Kept", value: promise_to_pay_status.KEPT },
  { label: "Broken", value: promise_to_pay_status.BROKEN },
  { label: "Cancelled", value: promise_to_pay_status.CANCELLED },
];

const VIEW_TABS: { label: string; value: PromiseTab }[] = [
  { label: "List", value: "list" },
  { label: "Calendar", value: "calendar" },
];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseStatus(value: string | undefined): PromiseStatus | undefined {
  if (
    value === promise_to_pay_status.OPEN ||
    value === promise_to_pay_status.KEPT ||
    value === promise_to_pay_status.BROKEN ||
    value === promise_to_pay_status.CANCELLED
  ) {
    return value;
  }

  return undefined;
}

function parseTab(value: string | undefined): PromiseTab {
  return value === "calendar" ? "calendar" : "list";
}

function toIsoDate(value: string | Date): string {
  return typeof value === "string"
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

function pageHref(page: number, params: PromisePageParams) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries({
    ...params,
    page: String(page),
  })) {
    if (value) {
      search.set(key, String(value));
    }
  }

  return `/promises-to-pay?${search.toString()}`;
}

function filterHref(status: PromiseStatus | "", params: PromisePageParams) {
  const search = new URLSearchParams();

  if (params.canonical_id) {
    search.set("canonical_id", params.canonical_id);
  }

  if (status) {
    search.set("status", status);
  }

  if (params.tab === "calendar") {
    search.set("tab", "calendar");
  }

  const query = search.toString();
  return query ? `/promises-to-pay?${query}` : "/promises-to-pay";
}

function tabHref(tab: PromiseTab, params: PromisePageParams) {
  const search = new URLSearchParams();

  if (params.canonical_id) {
    search.set("canonical_id", params.canonical_id);
  }

  if (params.status) {
    search.set("status", params.status);
  }

  if (params.promise) {
    search.set("promise", params.promise);
  }

  search.set("tab", tab);

  return `/promises-to-pay?${search.toString()}`;
}

function previewHref(promiseId: string, params: PromisePageParams) {
  return pageHref(1, { ...params, promise: promiseId });
}

function promiseStatusTag(status: PromiseStatus) {
  return `PTP_${status}`;
}

function outcomeTag(status: PromiseStatus) {
  if (status === promise_to_pay_status.KEPT) {
    return { label: "Kept", status: "PTP_KEPT" };
  }
  if (status === promise_to_pay_status.BROKEN) {
    return { label: "Broken", status: "PTP_BROKEN" };
  }
  if (status === promise_to_pay_status.CANCELLED) {
    return { label: "Cancelled", status: "PTP_CANCELLED" };
  }
  return { label: "Pending", status: "NO_DATA" };
}

async function getInvoiceRefs(invoiceIds: Array<string | null>) {
  const ids = [
    ...new Set(invoiceIds.filter((id): id is string => Boolean(id))),
  ];

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const invoices = await getPrisma().invoices.findMany({
    select: { id: true, invoice_ref: true },
    where: { id: { in: ids } },
  });

  return new Map(invoices.map((invoice) => [invoice.id, invoice.invoice_ref]));
}

function promiseColumns(): DataTableColumn<PromiseViewRow>[] {
  return [
    {
      cell: (promise) => (
        <div>
          <div className="font-mono text-[13px] font-semibold text-[var(--color-text)]">
            {promise.invoice_ref ?? "Unlinked promise"}
          </div>
          <div className="font-mono text-xs text-[var(--color-text-muted)]">
            {promise.id.slice(0, 8)}
          </div>
        </div>
      ),
      header: "Invoice",
      key: "invoice_ref",
      sticky: "left",
      width: "min-w-[180px]",
    },
    {
      cell: (promise) => (
        <div>
          <div className="truncate font-medium text-[var(--color-text)]">
            {promise.party_name}
          </div>
          <div className="font-mono text-xs text-[var(--color-text-muted)]">
            {promise.canonical_id.slice(0, 8)}
          </div>
        </div>
      ),
      header: "Party",
      key: "party_name",
      sticky: "left",
      width: "min-w-[240px]",
    },
    {
      align: "right",
      cell: (promise) => (
        <span className="font-medium tabular-nums">
          {formatCurrency(promise.amount.toString(), promise.currency)}
        </span>
      ),
      header: "Promised Amount",
      key: "amount",
    },
    {
      cell: (promise) => (
        <span className="text-[var(--color-text-muted)]">
          {formatDate(promise.promised_date)}
        </span>
      ),
      header: "Promised Date",
      key: "promised_date",
    },
    {
      cell: (promise) => (
        <StatusTag status={promiseStatusTag(promise.status)} />
      ),
      header: "Status",
      key: "status",
    },
    {
      cell: (promise) => {
        const outcome = outcomeTag(promise.status);
        return <StatusTag label={outcome.label} status={outcome.status} />;
      },
      header: "Kept/Broken",
      key: "outcome",
    },
    {
      cell: (promise) => (
        <span className="text-[var(--color-text-muted)]">
          {promise.contact_person || "No contact"}
        </span>
      ),
      header: "Contact Person",
      key: "contact_person",
    },
  ];
}

export default async function PromisesToPayPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const user = await requirePageRole(
    "/promises-to-pay",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const page = Math.max(1, Number(first(raw.page) ?? "1") || 1);
  const activeTab = parseTab(first(raw.tab));
  const params: PromisePageParams = {
    canonical_id: first(raw.canonical_id),
    page,
    promise: first(raw.promise),
    status: parseStatus(first(raw.status)),
    tab: activeTab,
  };
  const response = await listPromisesToPay(
    {
      canonical_id: params.canonical_id,
      page,
      status: params.status,
    },
    user,
  );
  const invoiceRefs = await getInvoiceRefs(
    response.items.map((promise) => promise.invoice_id),
  );
  const promises: PromiseViewRow[] = response.items.map((promise) => ({
    ...promise,
    invoice_ref: promise.invoice_id
      ? (invoiceRefs.get(promise.invoice_id) ?? null)
      : null,
    party_name: promise.parties_canonical?.name ?? promise.canonical_id,
  }));
  const calendarPromises = promises.map((promise) => ({
    id: promise.id,
    canonical_id: promise.canonical_id,
    party_name: promise.party_name,
    invoice_ref: promise.invoice_ref,
    promised_date: toIsoDate(promise.promised_date),
    amount: promise.amount,
    currency: promise.currency,
    status: promise.status,
    contact_person: promise.contact_person,
  }));
  const calendarSearchParams: Record<string, string | undefined> = {
    canonical_id: params.canonical_id,
    page: String(params.page),
    promise: params.promise,
    status: params.status,
    tab: params.tab,
  };
  const selectedPromise =
    promises.find((promise) => promise.id === params.promise) ??
    promises[0] ??
    null;
  const totalPages = Math.max(
    1,
    Math.ceil(response.total / response.page_size),
  );
  const openCount = promises.filter(
    (promise) => promise.status === promise_to_pay_status.OPEN,
  ).length;
  const keptCount = promises.filter(
    (promise) => promise.status === promise_to_pay_status.KEPT,
  ).length;
  const brokenCount = promises.filter(
    (promise) => promise.status === promise_to_pay_status.BROKEN,
  ).length;
  const isFiltered = Boolean(params.status || params.canonical_id);
  const selectedOutcome = selectedPromise
    ? outcomeTag(selectedPromise.status)
    : null;
  const selectedOpenHref = selectedPromise?.invoice_id
    ? `/invoice/${selectedPromise.invoice_id}`
    : selectedPromise
      ? `/party/${selectedPromise.canonical_id}`
      : undefined;
  const selectedOpenLabel = selectedPromise?.invoice_id
    ? "Open linked invoice"
    : "Open party record";

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
            href="/tasks"
          >
            <CalendarCheck className="h-4 w-4" />
            Review Tasks
          </Link>
        }
        title="Promises to Pay"
      >
        Track customer payment commitments, broken promises, and the next follow-up path.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Visible Promises"
          meta={`${response.total} in current filters`}
          value={promises.length}
        />
        <MetricCard
          label="Open"
          meta="Awaiting payment date"
          value={openCount}
        />
        <MetricCard label="Broken" meta="Needs follow-up" value={brokenCount} />
        <MetricCard label="Kept" meta="Closed successfully" value={keptCount} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewTabs>
            {STATUS_FILTERS.map((filter) => (
              <SavedViewLink
                active={(params.status ?? "") === filter.value}
                href={filterHref(filter.value, params)}
                key={filter.value || "all"}
              >
                {filter.label}
              </SavedViewLink>
            ))}
          </SavedViewTabs>

          <SavedViewTabs>
            {VIEW_TABS.map((tab) => {
              const Icon =
                tab.value === "calendar" ? CalendarCheck : ListChecks;
              return (
                <SavedViewLink
                  active={activeTab === tab.value}
                  href={tabHref(tab.value, params)}
                  key={tab.value}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </span>
                </SavedViewLink>
              );
            })}
          </SavedViewTabs>

          {activeTab === "calendar" ? (
            <PtpCalendar
              baseSearchParams={calendarSearchParams}
              promises={calendarPromises}
            />
          ) : null}

          {activeTab === "list" ? (
            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">
                    Promise Register
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    Open promises to inspect promised amount, due date, outcome, and linked account work.
                  </div>
                </div>
                {isFiltered ? (
                  <Link
                    className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
                    href="/promises-to-pay"
                  >
                    Clear filters
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                ) : null}
              </div>

              {params.canonical_id ? (
                <div className="border-b border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  Party filter active:{" "}
                  <span className="font-mono">{params.canonical_id}</span>
                </div>
              ) : null}

              <DataTable<PromiseViewRow>
                columns={promiseColumns()}
                emptyState={{
                  action: (
                    <Link
                      className="text-sm font-medium text-[var(--color-accent)]"
                      href="/tasks"
                    >
                      Review collection tasks
                    </Link>
                  ),
                  description:
                    "Promises appear after an analyst records a customer payment commitment.",
                  title: "No promises recorded yet",
                }}
                filteredEmptyState={{
                  action: (
                    <Link
                      className="text-sm font-medium text-[var(--color-accent)]"
                      href="/promises-to-pay"
                    >
                      View open promises
                    </Link>
                  ),
                  description:
                    "Clear filters or switch status views to continue promise review.",
                  title: "No promises match these filters",
                }}
                isFiltered={isFiltered}
                minWidthClass="min-w-[1120px]"
                rowHref={(promise) => previewHref(promise.id, params)}
                rowKey={(promise) => promise.id}
                rows={promises}
                selectedRowKey={selectedPromise?.id ?? null}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                <span>
                  Showing page {response.page} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
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
                    href={pageHref(
                      Math.min(totalPages, response.page + 1),
                      params,
                    )}
                  >
                    Next
                  </Link>
                </div>
              </div>
            </Panel>
          ) : null}
        </div>

        <RightRail>
          {selectedPromise ? (
            <SidePanel
              meta={`Updated ${formatDate(selectedPromise.updated_at)} - created ${formatDate(selectedPromise.created_at)}`}
              nextAction={
                <Link
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                  href={`/tasks?canonical_id=${selectedPromise.canonical_id}`}
                >
                  Review account work
                  <ArrowRight className="h-4 w-4" />
                </Link>
              }
              openFullPageHref={selectedOpenHref}
              openFullPageLabel={selectedOpenLabel}
              status={
                <StatusTag status={promiseStatusTag(selectedPromise.status)} />
              }
              subtitle={selectedPromise.party_name}
              title={selectedPromise.invoice_ref ?? "Unlinked promise"}
            >
              <div className="grid grid-cols-2 gap-3">
                <SidePanelField label="Promised Amount">
                  {formatCurrency(
                    selectedPromise.amount.toString(),
                    selectedPromise.currency,
                  )}
                </SidePanelField>
                <SidePanelField label="Promised Date">
                  {formatDate(selectedPromise.promised_date)}
                </SidePanelField>
                <SidePanelField label="Contact">
                  {selectedPromise.contact_person || "No contact"}
                </SidePanelField>
                <SidePanelField label="Currency">
                  {selectedPromise.currency}
                </SidePanelField>
              </div>

              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Promise outcome and next step
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[var(--color-text-muted)]">
                  <span>
                    {selectedPromise.status === promise_to_pay_status.BROKEN
                      ? "Broken promise: follow up with the account owner."
                      : selectedPromise.status === promise_to_pay_status.OPEN
                        ? "Waiting for promised payment date."
                        : "Kept or closed promise state."}
                  </span>
                  {selectedOutcome ? (
                    <StatusTag
                      label={selectedOutcome.label}
                      status={selectedOutcome.status}
                    />
                  ) : null}
                </div>
                <div className="mt-2 text-sm text-[var(--color-text-muted)]">
                  {selectedPromise.notes ||
                    "No notes recorded for this promise."}
                </div>
              </div>
            </SidePanel>
          ) : (
            <SidePanel title="No promise selected">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a promise from the register to inspect payment date,
                status, and linked account work here.
              </p>
            </SidePanel>
          )}

          <Panel>
            <PanelHeader title="Linked Workflows">
              Continue from the selected promise into the safest review path.
            </PanelHeader>
            {selectedPromise ? (
              <div className="space-y-2 p-4">
                {[
                  [
                    "Task queue",
                    `/tasks?canonical_id=${selectedPromise.canonical_id}`,
                  ],
                  ["Party page", `/party/${selectedPromise.canonical_id}`],
                  selectedPromise.invoice_id
                    ? [
                        "Linked invoice",
                        `/invoice/${selectedPromise.invoice_id}`,
                      ]
                    : null,
                ]
                  .filter((item): item is [string, string] => Boolean(item))
                  .map(([label, href]) => (
                    <Link
                      className="flex h-10 items-center justify-between rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                      href={href}
                      key={href}
                    >
                      {label}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ))}
              </div>
            ) : (
              <div className="p-4 text-sm text-[var(--color-text-muted)]">
                Select a promise to open its task queue, party page, or linked
                invoice.
              </div>
            )}
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
