import Link from "next/link";
import { ArrowRight, FileText, Filter, LayoutList, Rows3, Settings, Upload } from "lucide-react";
import { SavedViewSwitcher } from "@/components/saved-views/saved-view-switcher";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { MiniSparkline } from "@/components/ui/mini-chart";
import { RowActionLink } from "@/components/ui/row-actions";
import { SidePanel, SidePanelField } from "@/components/ui/side-panel";
import { StatusTag } from "@/components/ui/status-tag";
import { ViewPreferenceSync } from "@/components/interaction/view-preference-sync";
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
import {
  InvoiceChangesPanel,
  type InvoiceChangeItem,
} from "./_components/invoice-changes-panel";
import { listInvoiceChanges } from "@/server/invoice-changes/service";
import { listLobs } from "@/server/lobs/service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type InvoicePageParams = {
  change_status?: string;
  entity?: string;
  has_active_exceptions?: string;
  invoice?: string;
  lob?: string;
  overdue_bucket?: string;
  page_size: number;
  party_canonical_id?: string;
  status?: string;
  system_view?: string;
  view?: InvoiceViewMode;
};

type InvoiceViewMode = "table" | "compact";

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
  if (bucket === "DUE_TODAY") return "var(--color-warning)";
  if (bucket === "0_30") return "var(--color-success)";
  if (bucket === "31_60") return "var(--color-warning)";
  if (bucket === "61_90") return "var(--color-warning)";
  return "var(--color-danger)";
}

function invoiceViewHref(view: InvoiceViewMode, params: InvoicePageParams) {
  return pageHref(1, { ...params, view });
}

function suggestedAction(invoice: InvoiceListRow) {
  if (invoice.active_exception_count > 0) return "Review exception";
  if (invoice.bucket === "90_PLUS") return "Escalation review";
  if (invoice.bucket === "61_90") return "Manager follow-up";
  if (invoice.bucket === "31_60") return "Promise follow-up";
  if (invoice.bucket === "0_30") return "Customer follow-up";
  return "No action needed";
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
        <div className="flex items-center gap-2">
          <Link
            className="font-mono text-[13px] font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-strong)]"
            href={`/invoice/${invoice.invoice_id}`}
          >
            {invoice.invoice_ref}
          </Link>
          {invoice.is_new_in_latest_snapshot ? (
            <span
              className="rounded-full bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]"
              title="First seen in the most recent published snapshot"
            >
              New
            </span>
          ) : null}
          {invoice.is_closed_in_latest_snapshot ? (
            <span
              className="rounded-full bg-[var(--color-status-danger-bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-status-danger-text)]"
              title="Settled by the most recent published snapshot — attached actions auto-resolved"
            >
              Closed
            </span>
          ) : null}
          {invoice.unack_change_count_in_latest_snapshot > 0 ? (
            <span
              className="rounded-full bg-[var(--color-status-warning-bg)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-status-warning-text)]"
              title={`${invoice.unack_change_count_in_latest_snapshot} field change(s) detected in the latest snapshot — review`}
            >
              Changed ({invoice.unack_change_count_in_latest_snapshot})
            </span>
          ) : null}
        </div>
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
      key: "lob",
      header: "LOB",
      cell: (invoice) =>
        invoice.lob_code ? (
          <span
            className="inline-flex items-center rounded-full bg-[var(--color-bg-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text)]"
            title={invoice.lob_name ?? undefined}
          >
            {invoice.lob_code}
          </span>
        ) : (
          <span className="text-xs text-[var(--color-text-subtle)]">—</span>
        ),
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
    {
      key: "action",
      header: "Action",
      align: "right",
      width: "w-16",
      cell: (invoice) => (
        <RowActionLink
          href={`/invoice/${invoice.invoice_id}`}
          label={`Open invoice ${invoice.invoice_ref}`}
        />
      ),
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
    params.change_status,
    params.lob,
  ].filter(Boolean).length;
}

function activeFilterLabels(params: InvoicePageParams) {
  const labels: string[] = [];
  if (params.entity) labels.push(`Entity: ${params.entity}`);
  if (params.status) labels.push(`Status: ${params.status}`);
  if (params.overdue_bucket) labels.push(`Bucket: ${params.overdue_bucket}`);
  if (params.has_active_exceptions === "true") labels.push("Has exceptions");
  if (params.has_active_exceptions === "false") labels.push("No exceptions");
  if (params.party_canonical_id) labels.push("Account filtered");
  if (params.system_view) labels.push("System view");
  if (params.change_status) labels.push(`Change: ${params.change_status}`);
  if (params.lob) labels.push(`LOB: ${params.lob}`);
  return labels;
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/invoices",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  const raw = await searchParams;
  const page = Number(first(raw.page) ?? "1");
  const pageSize = Number(first(raw.page_size) ?? "25");
  const systemViewId = parseSystemViewId(first(raw.system_view));
  const systemViewParams = getInvoiceSystemViewParams(systemViewId);
  const rawChangeStatus = first(raw.change_status);
  const changeStatus:
    | "new"
    | "closed"
    | "changed"
    | "all"
    | undefined =
    rawChangeStatus === "new"
      ? "new"
      : rawChangeStatus === "closed"
        ? "closed"
        : rawChangeStatus === "changed"
          ? "changed"
          : rawChangeStatus === "all"
            ? "all"
            : undefined;
  const params: InvoicePageParams = {
    entity: first(raw.entity),
    status: systemViewParams?.status ?? first(raw.status),
    overdue_bucket:
      systemViewParams?.overdue_bucket ?? first(raw.overdue_bucket),
    has_active_exceptions: first(raw.has_active_exceptions),
    party_canonical_id: first(raw.party_canonical_id),
    change_status: changeStatus,
    lob: first(raw.lob),
    page_size: pageSize,
    system_view: systemViewId ?? undefined,
    invoice: first(raw.invoice),
    view: first(raw.view) === "compact" ? "compact" : "table",
  };
  const response = await listInvoices(
    {
      entity: params.entity,
      status: params.status,
      overdue_bucket: params.overdue_bucket,
      has_active_exceptions: parseBool(params.has_active_exceptions),
      party_canonical_id: params.party_canonical_id,
      change_status: changeStatus,
      lob: params.lob,
      page,
      page_size: pageSize,
    },
    currentUser,
  );

  // PR 9 — populate the LOB filter dropdown with active LOBs scoped to
  // the current user (analysts see their entity only; ADMIN/CFO/REVIEWER
  // see all).
  const availableLobs = await listLobs(
    { active: true, entity_code: params.entity as "IND" | "UAE" | undefined },
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
  // PR 3 / Gap 3 — fetch the changes history for the selected invoice so the
  // side-panel can render the diff list + Acknowledge action. Cheap query
  // (indexed on invoice_id) — no need to gate on unack_count.
  const selectedInvoiceChanges: InvoiceChangeItem[] = selectedInvoice
    ? await listInvoiceChanges(selectedInvoice.invoice_id, currentUser)
    : [];
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
  const filterLabels = activeFilterLabels(params);

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

      <ViewPreferenceSync
        currentView={params.view ?? "table"}
        storageKey="receivables.invoices.view-mode.v1"
        validViews={["table", "compact"]}
      />

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
            <SavedViewLink
              active={!systemViewId && changeStatus !== "new"}
              href="/invoices"
            >
              All Invoices
            </SavedViewLink>
            <SavedViewLink
              active={changeStatus === "new"}
              href="/invoices?change_status=new"
            >
              New Since Last Upload
            </SavedViewLink>
            <SavedViewLink
              active={changeStatus === "closed"}
              href="/invoices?change_status=closed"
            >
              Closed This Snapshot
            </SavedViewLink>
            <SavedViewLink
              active={changeStatus === "changed"}
              href="/invoices?change_status=changed"
            >
              Changed Since Last Upload
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
                <div className="sm:col-span-2">
                  <div className="text-sm font-semibold text-[var(--color-text)]">
                    Narrow the review queue
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    Use filters to isolate blocked, overdue, changed, or unassigned AR work.
                  </p>
                </div>
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
                  <option value="NOT_DUE">Not Due</option>
                  <option value="DUE_TODAY">Due Today</option>
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
                <select
                  className={fieldClass}
                  defaultValue={params.lob ?? ""}
                  name="lob"
                >
                  <option value="">All LOBs</option>
                  <option value="__none__">Untagged</option>
                  {availableLobs.map((lob) => (
                    <option key={lob.id} value={lob.code}>
                      {lob.code} — {lob.name}
                    </option>
                  ))}
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
            {filterLabels.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  Applied filters
                </span>
                {filterLabels.map((label) => (
                  <span
                    className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs text-[var(--color-text)]"
                    key={label}
                  >
                    {label}
                  </span>
                ))}
                <Link
                  className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                  href="/invoices"
                >
                  Clear filters
                </Link>
              </div>
            ) : null}
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
              <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
                <Link
                  aria-current={params.view === "table" ? "page" : undefined}
                  className={[
                    "inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-xs font-medium transition-colors",
                    params.view === "table"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
                  ].join(" ")}
                  href={invoiceViewHref("table", params)}
                >
                  <Rows3 className="h-3.5 w-3.5" />
                  Table
                </Link>
                <Link
                  aria-current={params.view === "compact" ? "page" : undefined}
                  className={[
                    "inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-xs font-medium transition-colors",
                    params.view === "compact"
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
                  ].join(" ")}
                  href={invoiceViewHref("compact", params)}
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  Compact
                </Link>
              </div>
            </div>

            {params.view === "compact" ? (
              <div className="divide-y divide-[var(--color-border)]">
                {response.items.length === 0 ? (
                  <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
                    {activeFilterCount > 0
                      ? "No invoices match these filters."
                      : "No invoices yet."}
                  </div>
                ) : (
                  response.items.map((invoice) => (
                    <Link
                      className={[
                        "group grid gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-bg-subtle)] md:grid-cols-[minmax(0,1fr)_140px_140px_120px_40px]",
                        selectedInvoice?.invoice_id === invoice.invoice_id
                          ? "bg-[var(--color-accent-soft)]"
                          : "",
                      ].join(" ")}
                      href={previewHref(invoice.invoice_id, params)}
                      key={invoice.invoice_id}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm font-semibold text-[var(--color-accent)]">
                          {invoice.invoice_ref}
                        </div>
                        <div className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
                          {invoice.canonical_name || "Unmatched account"} · {invoice.entity_code}
                        </div>
                      </div>
                      <StatusTag status={invoice.bucket} />
                      <span className="font-medium tabular-nums">
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {suggestedAction(invoice)}
                      </span>
                      <ArrowRight className="h-4 w-4 justify-self-end text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-accent)]" />
                    </Link>
                  ))
                )}
              </div>
            ) : (
              <DataTable<InvoiceListRow>
                columns={invoiceColumns()}
                emptyState={{
                  icon: <FileText className="h-6 w-6" />,
                  title: "No invoices yet",
                  description:
                    "Upload a Tally or Xero workbook, walk it through staging, and publish — invoices land here after publish.",
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
                  title: "Nothing matches these filters",
                  description:
                    "Try clearing filters or switching to another saved view to see invoices across the rest of the ledger.",
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
              rowCreateHref={(invoice) =>
                `/follow-ups?invoice_id=${invoice.invoice_id}`
              }
              rowEditHref={(invoice) => `/invoice/${invoice.invoice_id}`}
              rowKey={(invoice) => invoice.invoice_id}
                rows={response.items}
                selectedRowKey={selectedInvoice?.invoice_id ?? null}
              />
            )}

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

          {selectedInvoice && selectedInvoiceChanges.length > 0 ? (
            <InvoiceChangesPanel
              initialChanges={selectedInvoiceChanges}
              invoiceId={selectedInvoice.invoice_id}
            />
          ) : null}

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
