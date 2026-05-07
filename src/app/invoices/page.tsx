import Link from "next/link";
import { ArrowRight, Filter, Settings, Upload } from "lucide-react";
import { SavedViewSwitcher } from "@/components/saved-views/saved-view-switcher";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { MiniSparkline } from "@/components/ui/mini-chart";
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
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import type { InvoiceListRow } from "@/server/invoices/service";
import { listInvoices } from "@/server/invoices/service";
import { buildBucketSummaries } from "@/server/invoices/workbench";
import {
  buildSystemViewHref,
  getInvoiceSystemViewParams,
  getSystemViewsForSurface,
  parseSystemViewId,
} from "@/server/views/system-views";
import { ExportRegisterButton } from "./_components/export-register-button";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type InvoicePageParams = {
  entity?: string;
  has_active_exceptions?: string;
  invoice?: string;
  overdue_bucket?: string;
  page_size: number;
  party_canonical_id?: string;
  status?: string;
  system_view?: string;
};

const fieldClass =
  "h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)]";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function pageHref(page: number, params: InvoicePageParams) {
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

function previewHref(invoiceId: string, params: InvoicePageParams) {
  return pageHref(1, { ...params, invoice: invoiceId });
}

function toNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function bucketAccent(bucket: string) {
  if (bucket === "NOT_DUE") return "var(--color-accent)";
  if (bucket === "0_30") return "var(--color-success)";
  if (bucket === "31_60") return "var(--color-warning)";
  if (bucket === "61_90") return "#f97316";
  return "var(--color-danger)";
}

function suggestedAction(invoice: InvoiceListRow) {
  if (invoice.active_exception_count > 0) return "Review exception";
  if (invoice.bucket === "90_PLUS") return "Escalation review";
  if (invoice.bucket === "61_90") return "Manager follow-up";
  if (invoice.bucket === "31_60") return "Promise follow-up";
  if (invoice.bucket === "0_30") return "Customer follow-up";
  return "Monitor";
}

function riskTag(invoice: InvoiceListRow) {
  if (invoice.active_exception_count > 0) {
    return { label: "Exception", status: "90_PLUS" };
  }
  if (invoice.bucket === "90_PLUS") return { label: "Critical", status: "90_PLUS" };
  if (invoice.bucket === "61_90") return { label: "High", status: "61_90" };
  if (invoice.bucket === "31_60") return { label: "Medium", status: "31_60" };
  return { label: "Low", status: "NOT_DUE" };
}

function invoiceColumns(): DataTableColumn<InvoiceListRow>[] {
  return [
    {
      key: "ref",
      header: "Invoice",
      sticky: "left",
      width: "min-w-[160px]",
      cell: (invoice) => (
        <Link
          className="font-mono text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
          href={`/invoice/${invoice.invoice_id}`}
        >
          {invoice.invoice_ref}
        </Link>
      ),
    },
    {
      key: "account",
      header: "Account",
      sticky: "left",
      width: "min-w-[220px]",
      cell: (invoice) => (
        <div>
          <Link
            className="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
            href={`/party/${invoice.canonical_id}`}
          >
            {invoice.canonical_name || "Unmatched account"}
          </Link>
          <div className="text-xs text-[var(--color-text-muted)]">
            {invoice.entity_code}
          </div>
        </div>
      ),
    },
    {
      key: "issue_date",
      header: "Issue",
      cell: (invoice) => (
        <span className="text-[var(--color-text-muted)]">
          {formatDate(invoice.invoice_date)}
        </span>
      ),
    },
    {
      key: "due_date",
      header: "Due",
      cell: (invoice) => (
        <span className="text-[var(--color-text-muted)]">
          {formatDate(invoice.due_date)}
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      align: "right",
      cell: (invoice) => invoice.overdue_days ?? "-",
    },
    {
      key: "bucket",
      header: "Bucket",
      cell: (invoice) => <StatusTag status={invoice.bucket} />,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      align: "right",
      cell: (invoice) => (
        <span className="font-medium tabular-nums">
          {formatCurrency(invoice.amount, invoice.currency)}
        </span>
      ),
    },
    {
      key: "risk",
      header: "Risk",
      cell: (invoice) => {
        const risk = riskTag(invoice);
        return <StatusTag label={risk.label} status={risk.status} />;
      },
    },
    {
      key: "next_action",
      header: "Next Action",
      cell: (invoice) => (
        <span className="text-[var(--color-text-muted)]">
          {suggestedAction(invoice)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (invoice) => <StatusTag status={invoice.status} />,
    },
  ];
}

function filterCount(params: InvoicePageParams) {
  return [
    params.entity,
    params.status,
    params.overdue_bucket,
    params.has_active_exceptions,
    params.party_canonical_id,
    params.system_view,
  ].filter(Boolean).length;
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
  const pageSize = Number(first(raw.page_size) ?? "25");
  const systemViewId = parseSystemViewId(first(raw.system_view));
  const systemViewParams = getInvoiceSystemViewParams(systemViewId);
  const params: InvoicePageParams = {
    entity: first(raw.entity),
    status: systemViewParams?.status ?? first(raw.status),
    overdue_bucket:
      systemViewParams?.overdue_bucket ?? first(raw.overdue_bucket),
    has_active_exceptions: first(raw.has_active_exceptions),
    party_canonical_id: first(raw.party_canonical_id),
    page_size: pageSize,
    system_view: systemViewId ?? undefined,
    invoice: first(raw.invoice),
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
  const bucketSummaries = buildBucketSummaries(
    response.items.map((invoice) => ({
      amount: invoice.amount,
      bucket: invoice.bucket,
    })),
  );
  const selectedInvoice =
    response.items.find((invoice) => invoice.invoice_id === params.invoice) ??
    response.items[0] ??
    null;
  const totalOutstanding = response.items.reduce(
    (sum, invoice) => sum + toNumber(invoice.amount),
    0,
  );
  const totalInvoices = bucketSummaries.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  const exceptionCount = response.items.reduce(
    (sum, invoice) => sum + invoice.active_exception_count,
    0,
  );
  const activeFilterCount = filterCount(params);

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)]"
              href="/upload"
            >
              <Upload className="h-4 w-4" />
              Import Invoices
            </Link>
            <ExportRegisterButton
              entity={params.entity}
              status={params.status}
            />
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/config"
            >
              <Settings className="h-4 w-4" />
              Ageing Config
            </Link>
          </>
        }
        title="Invoice Ageing Workbench"
      >
        Review invoices by ageing bucket, exception state, and next review path.
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {bucketSummaries.map((bucket) => (
          <MetricCard
            accent={<StatusTag status={bucket.bucket} />}
            key={bucket.bucket}
            label={bucket.label}
            meta={`${bucket.count} invoices · ${bucket.percent}% of visible AR`}
            value={formatCurrency(bucket.amount, "INR")}
          />
        ))}
        <MetricCard
          accent={<MiniSparkline color="var(--color-accent)" />}
          label="Visible Outstanding"
          meta={`${response.total} invoices in the current result set`}
          value={formatCurrency(totalOutstanding, "INR")}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewSwitcher
            currentUserRole={currentUser.role}
            surface="invoices"
          />
          <SavedViewTabs>
            <SavedViewLink active={!systemViewId} href="/invoices">
              All Invoices
            </SavedViewLink>
            {systemViews.map((view) => (
              <SavedViewLink
                active={systemViewId === view.id}
                href={buildSystemViewHref(view.id, "invoices")}
                key={view.id}
              >
                {view.label}
              </SavedViewLink>
            ))}
          </SavedViewTabs>

          <Panel>
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_520px]">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  Ageing Distribution
                  <span className="text-xs font-normal text-[var(--color-text-muted)]">
                    {totalInvoices} bucketed invoices
                  </span>
                </div>
                <div className="mt-4 flex h-9 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)]">
                  {bucketSummaries.map((bucket) => (
                    <div
                      className="grid min-w-8 place-items-center text-xs font-semibold text-white transition-[width]"
                      key={bucket.bucket}
                      style={{
                        backgroundColor: bucketAccent(bucket.bucket),
                        width: `${Math.max(bucket.percent, bucket.count > 0 ? 5 : 0)}%`,
                      }}
                      title={`${bucket.label}: ${bucket.percent}%`}
                    >
                      {bucket.percent > 7 ? `${bucket.percent}%` : null}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {bucketSummaries.map((bucket) => (
                    <span
                      className="inline-flex items-center gap-2 text-xs text-[var(--color-text-muted)]"
                      key={bucket.bucket}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: bucketAccent(bucket.bucket) }}
                      />
                      {bucket.label}
                    </span>
                  ))}
                </div>
              </div>

              <form action="/invoices" className="grid gap-3 sm:grid-cols-2">
                <input name="page_size" type="hidden" value={pageSize} />
                <select className={fieldClass} defaultValue={params.entity ?? ""} name="entity">
                  <option value="">All entities</option>
                  <option value="IND">IND</option>
                  <option value="UAE">UAE</option>
                </select>
                <select className={fieldClass} defaultValue={params.status ?? ""} name="status">
                  <option value="">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="SETTLED">Settled</option>
                </select>
                <select
                  className={fieldClass}
                  defaultValue={params.overdue_bucket ?? ""}
                  name="overdue_bucket"
                >
                  <option value="">All buckets</option>
                  <option value="NOT_DUE">Current</option>
                  <option value="0_30">1-30 Days</option>
                  <option value="31_60">31-60 Days</option>
                  <option value="61_90">61-90 Days</option>
                  <option value="90_PLUS">91+ Days</option>
                </select>
                <select
                  className={fieldClass}
                  defaultValue={params.has_active_exceptions ?? ""}
                  name="has_active_exceptions"
                >
                  <option value="">Exception status</option>
                  <option value="true">Has active exceptions</option>
                  <option value="false">No active exceptions</option>
                </select>
                <Button className="sm:col-span-2" type="submit">
                  <Filter className="h-4 w-4" />
                  Apply Filters
                  {activeFilterCount ? (
                    <span className="rounded-full bg-white/20 px-2 text-xs">
                      {activeFilterCount}
                    </span>
                  ) : null}
                </Button>
              </form>
            </div>
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Invoice Review Queue
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Open any invoice to inspect detail, account context, and follow-up paths.
                </div>
              </div>
            </div>

            <DataTable<InvoiceListRow>
              columns={invoiceColumns()}
              emptyState={{
                title: "No invoices yet",
                description:
                  "Invoices appear here after a workbook is staged, parsed, reviewed, and published.",
                action: (
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href="/snapshots"
                  >
                    Upload snapshot
                  </Link>
                ),
              }}
              filteredEmptyState={{
                title: "No invoices match these filters",
                description:
                  "Try clearing filters or switching to another saved view.",
                action: (
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href="/invoices"
                  >
                    Clear filters
                  </Link>
                ),
              }}
              isFiltered={activeFilterCount > 0}
              minWidthClass="min-w-[1120px]"
              rowHref={(invoice) => previewHref(invoice.invoice_id, params)}
              rowKey={(invoice) => invoice.invoice_id}
              rows={response.items}
              selectedRowKey={selectedInvoice?.invoice_id ?? null}
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
                  href={pageHref(Math.min(totalPages, response.page + 1), params)}
                >
                  Next
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        <RightRail>
          {selectedInvoice ? (
            <SidePanel
              meta={`${selectedInvoice.entity_code} · last reviewed ${formatDate(selectedInvoice.invoice_date)}`}
              nextAction={
                <Link
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                  href={`/follow-ups?invoice_id=${selectedInvoice.invoice_id}`}
                >
                  Log follow-up
                  <ArrowRight className="h-4 w-4" />
                </Link>
              }
              openFullPageHref={`/invoice/${selectedInvoice.invoice_id}`}
              status={<StatusTag status={selectedInvoice.bucket} />}
              subtitle={selectedInvoice.canonical_name || "Unmatched account"}
              title={selectedInvoice.invoice_ref}
            >
              <div className="grid grid-cols-2 gap-3">
                <SidePanelField label="Amount">
                  {formatCurrency(selectedInvoice.amount, selectedInvoice.currency)}
                </SidePanelField>
                <SidePanelField label="Age">
                  {selectedInvoice.overdue_days ?? 0} days
                </SidePanelField>
                <SidePanelField label="Issue Date">
                  {formatDate(selectedInvoice.invoice_date)}
                </SidePanelField>
                <SidePanelField label="Due Date">
                  {formatDate(selectedInvoice.due_date)}
                </SidePanelField>
              </div>

              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Next Review Path
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[var(--color-text-muted)]">
                  <span>{suggestedAction(selectedInvoice)}</span>
                  <StatusTag
                    label={
                      selectedInvoice.active_exception_count > 0
                        ? `${selectedInvoice.active_exception_count} active`
                        : "No exception"
                    }
                    status={
                      selectedInvoice.active_exception_count > 0
                        ? "STAGING_BLOCKED"
                        : "NO_DATA"
                    }
                  />
                </div>
              </div>
            </SidePanel>
          ) : (
            <SidePanel title="No invoice selected">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select an invoice from the queue to inspect ageing, exception,
                and account context here.
              </p>
            </SidePanel>
          )}

          <Panel>
            <PanelHeader title="Linked Workflows">
              Route the selected invoice into active review surfaces.
            </PanelHeader>
            {selectedInvoice ? (
              <div className="space-y-2 p-4">
                {[
                  ["Log follow-up", `/follow-ups?invoice_id=${selectedInvoice.invoice_id}`],
                  ["Task queue", `/tasks?canonical_id=${selectedInvoice.canonical_id}`],
                  ["Promises", `/promises-to-pay?canonical_id=${selectedInvoice.canonical_id}`],
                  ["Exceptions", `/exceptions?invoice_id=${selectedInvoice.invoice_id}`],
                ].map(([label, href]) => (
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
                Select an invoice to open related follow-up, task, promise,
                and exception workflows.
              </div>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Queue Health">
              Current page only.
            </PanelHeader>
            <div className="space-y-3 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Visible invoices</span>
                <span className="font-semibold">{response.items.length}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Active exceptions</span>
                <span className="font-semibold">{exceptionCount}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Filters applied</span>
                <span className="font-semibold">{activeFilterCount}</span>
              </div>
            </div>
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
