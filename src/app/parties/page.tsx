import Link from "next/link";
import { ArrowRight, Building2, Upload } from "lucide-react";
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
import {
  collection_task_status,
  role_enum,
} from "@/generated/prisma/enums";
import { formatCurrency } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import {
  listAccounts,
  type AccountListRow,
} from "@/server/accounts/service";
import { requirePageRole } from "@/server/core/page-auth";

export const dynamic = "force-dynamic";

type PartiesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AccountView = "all" | "high-risk" | "watch" | "india" | "uae";

type PartyRegisterFacts = {
  ninety_plus_exposure: string;
  open_task_count: number;
};

type PartyRegisterRow = AccountListRow & PartyRegisterFacts;

const ACTIVE_TASK_STATUSES = [
  collection_task_status.SUGGESTED,
  collection_task_status.OPEN,
  collection_task_status.IN_PROGRESS,
  collection_task_status.SNOOZED,
] satisfies collection_task_status[];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseAccountView(value: string | undefined): AccountView {
  if (
    value === "high-risk" ||
    value === "watch" ||
    value === "india" ||
    value === "uae"
  ) {
    return value;
  }

  return "all";
}

function healthStatus(health: string) {
  if (health === "At Risk") return "90_PLUS";
  if (health === "Watch") return "31_60";
  return "NOT_DUE";
}

function viewHref(view: AccountView) {
  return view === "all" ? "/parties" : `/parties?view=${view}`;
}

function previewHref(accountId: string, view: AccountView) {
  const search = new URLSearchParams();

  if (view !== "all") {
    search.set("view", view);
  }

  search.set("party", accountId);
  return `/parties?${search.toString()}`;
}

function toCents(value: number | string | { toString: () => string } | null) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

async function getPartyRegisterFacts(
  canonicalIds: string[],
): Promise<Map<string, PartyRegisterFacts>> {
  const ids = [...new Set(canonicalIds)];
  const openTaskCounts = new Map<string, number>();
  const ninetyPlusCents = new Map<string, number>();

  for (const id of ids) {
    openTaskCounts.set(id, 0);
    ninetyPlusCents.set(id, 0);
  }

  if (ids.length === 0) {
    return new Map();
  }

  const prisma = getPrisma();
  const [activeTasks, openInvoices] = await prisma.$transaction([
    prisma.collection_tasks.findMany({
      select: { canonical_id: true },
      where: {
        canonical_id: { in: ids },
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    }),
    prisma.invoices.findMany({
      select: {
        canonical_id: true,
        invoice_snapshots: {
          orderBy: { as_of_date: "desc" },
          select: {
            bucket: true,
            outstanding_amount: true,
          },
          take: 1,
        },
      },
      where: {
        canonical_id: { in: ids },
        status: "OPEN",
      },
    }),
  ]);

  for (const task of activeTasks) {
    openTaskCounts.set(
      task.canonical_id,
      (openTaskCounts.get(task.canonical_id) ?? 0) + 1,
    );
  }

  for (const invoice of openInvoices) {
    const latestSnapshot = invoice.invoice_snapshots.at(0);

    if (latestSnapshot?.bucket === "90_PLUS") {
      ninetyPlusCents.set(
        invoice.canonical_id,
        (ninetyPlusCents.get(invoice.canonical_id) ?? 0) +
          toCents(latestSnapshot.outstanding_amount),
      );
    }
  }

  return new Map(
    ids.map((id) => [
      id,
      {
        ninety_plus_exposure: fromCents(ninetyPlusCents.get(id) ?? 0),
        open_task_count: openTaskCounts.get(id) ?? 0,
      },
    ]),
  );
}

function partyColumns(): DataTableColumn<PartyRegisterRow>[] {
  return [
    {
      cell: (account) => (
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--color-text)]">
              {account.canonical_name}
            </div>
            <div className="font-mono text-xs text-[var(--color-text-muted)]">
              {account.canonical_id.slice(0, 8)}
            </div>
          </div>
        </div>
      ),
      header: "Canonical Name",
      key: "canonical_name",
      sticky: "left",
      width: "min-w-[260px]",
    },
    {
      cell: (account) => (
        <span className="font-mono text-xs font-semibold text-[var(--color-text)]">
          {account.entity_code}
        </span>
      ),
      header: "Entity",
      key: "entity_code",
      sticky: "left",
      width: "min-w-[110px]",
    },
    {
      align: "right",
      cell: (account) => (
        <span className="font-medium tabular-nums">
          {formatCurrency(account.total_outstanding, account.currency_display)}
        </span>
      ),
      header: "Total Open Exposure",
      key: "total_open_exposure",
    },
    {
      align: "right",
      cell: (account) => (
        <span className="tabular-nums">
          {formatCurrency(
            account.ninety_plus_exposure,
            account.currency_display,
          )}
        </span>
      ),
      header: "90+ Exposure",
      key: "ninety_plus_exposure",
    },
    {
      align: "right",
      cell: (account) => (
        <span className="tabular-nums">{account.open_invoice_count}</span>
      ),
      header: "Open Invoices",
      key: "open_invoice_count",
    },
    {
      align: "right",
      cell: (account) => (
        <span className="tabular-nums">{account.open_task_count}</span>
      ),
      header: "Open Tasks",
      key: "open_task_count",
    },
    {
      cell: (account) => (
        <StatusTag
          label={account.collection_health}
          status={healthStatus(account.collection_health)}
        />
      ),
      header: "Status",
      key: "status",
    },
  ];
}

export default async function PartiesPage({ searchParams }: PartiesPageProps) {
  const user = await requirePageRole(
    "/parties",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  const params = await searchParams;
  const accounts = await listAccounts(user);
  const facts = await getPartyRegisterFacts(
    accounts.map((account) => account.canonical_id),
  );
  const partyRows: PartyRegisterRow[] = accounts.map((account) => ({
    ...account,
    ...(facts.get(account.canonical_id) ?? {
      ninety_plus_exposure: "0.00",
      open_task_count: 0,
    }),
  }));
  const activeView = parseAccountView(first(params.view));
  const visibleAccounts = partyRows.filter((account) => {
    if (activeView === "high-risk") {
      return account.collection_health === "At Risk";
    }
    if (activeView === "watch") {
      return account.collection_health === "Watch";
    }
    if (activeView === "india") {
      return account.entity_code.toUpperCase() === "IND";
    }
    if (activeView === "uae") {
      return account.entity_code.toUpperCase() === "UAE";
    }
    return true;
  });
  const selectedId = first(params.party) ?? first(params.account);
  const selectedAccount =
    visibleAccounts.find((account) => account.canonical_id === selectedId) ??
    visibleAccounts[0] ??
    null;
  const highRiskCount = visibleAccounts.filter(
    (account) => account.collection_health === "At Risk",
  ).length;
  const watchCount = visibleAccounts.filter(
    (account) => account.collection_health === "Watch",
  ).length;
  const openInvoiceCount = visibleAccounts.reduce(
    (sum, account) => sum + account.open_invoice_count,
    0,
  );
  const openTaskCount = visibleAccounts.reduce(
    (sum, account) => sum + account.open_task_count,
    0,
  );
  const ninetyPlusExposure = visibleAccounts.reduce(
    (sum, account) => sum + toCents(account.ninety_plus_exposure),
    0,
  );
  const isFiltered = activeView !== "all";

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
            href="/upload"
          >
            <Upload className="h-4 w-4" />
            Upload Snapshot
          </Link>
        }
        title="Parties"
      >
        Manage customer relationships and monitor party health.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Visible Parties"
          meta="Current party view"
          value={visibleAccounts.length}
        />
        <MetricCard
          label="High Risk Parties"
          meta="90+ or active exceptions"
          value={highRiskCount}
        />
        <MetricCard
          label="Watch Parties"
          meta="31-90 day exposure"
          value={watchCount}
        />
        <MetricCard
          label="Open Invoices"
          meta="Across visible parties"
          value={openInvoiceCount}
        />
        <MetricCard
          label="90+ Exposure"
          meta={`${openTaskCount} open tasks`}
          value={formatCurrency(fromCents(ninetyPlusExposure), "INR")}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewTabs>
            <SavedViewLink active={activeView === "all"} href={viewHref("all")}>
              All Parties
            </SavedViewLink>
            <SavedViewLink
              active={activeView === "high-risk"}
              href={viewHref("high-risk")}
            >
              High Risk
            </SavedViewLink>
            <SavedViewLink
              active={activeView === "watch"}
              href={viewHref("watch")}
            >
              Watch
            </SavedViewLink>
            <SavedViewLink
              active={activeView === "india"}
              href={viewHref("india")}
            >
              India
            </SavedViewLink>
            <SavedViewLink active={activeView === "uae"} href={viewHref("uae")}>
              UAE
            </SavedViewLink>
          </SavedViewTabs>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Party Register
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Open any party to inspect exposure, task load, and workflow
                  paths.
                </div>
              </div>
              <Link
                className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
                href="/config"
              >
                Manage aliases
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <DataTable<PartyRegisterRow>
              columns={partyColumns()}
              emptyState={{
                action: (
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href="/upload"
                  >
                    Upload snapshot
                  </Link>
                ),
                description:
                  "Parties appear after a workbook is staged, reviewed, and published.",
                title: "No parties yet",
              }}
              filteredEmptyState={{
                action: (
                  <Link
                    className="text-sm font-medium text-[var(--color-accent)]"
                    href="/parties"
                  >
                    View all parties
                  </Link>
                ),
                description:
                  "Switch to all parties or choose another saved view to continue account review.",
                title: "No parties match this view",
              }}
              isFiltered={isFiltered}
              minWidthClass="min-w-[1060px]"
              rowHref={(account) => previewHref(account.canonical_id, activeView)}
              rowKey={(account) => account.canonical_id}
              rows={visibleAccounts}
              selectedRowKey={selectedAccount?.canonical_id ?? null}
            />
          </Panel>
        </div>

        <RightRail>
          {selectedAccount ? (
            <SidePanel
              meta={`Audit record ${selectedAccount.canonical_id.slice(0, 8)} - ${selectedAccount.entity_code}`}
              nextAction={
                <Link
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                  href={`/tasks?canonical_id=${selectedAccount.canonical_id}`}
                >
                  Review tasks
                  <ArrowRight className="h-4 w-4" />
                </Link>
              }
              openFullPageHref={`/party/${selectedAccount.canonical_id}`}
              status={
                <StatusTag
                  label={selectedAccount.collection_health}
                  status={healthStatus(selectedAccount.collection_health)}
                />
              }
              subtitle={`${selectedAccount.entity_code} account`}
              title={selectedAccount.canonical_name}
            >
              <div className="grid grid-cols-2 gap-3">
                <SidePanelField label="Total Open">
                  {formatCurrency(
                    selectedAccount.total_outstanding,
                    selectedAccount.currency_display,
                  )}
                </SidePanelField>
                <SidePanelField label="90+ Exposure">
                  {formatCurrency(
                    selectedAccount.ninety_plus_exposure,
                    selectedAccount.currency_display,
                  )}
                </SidePanelField>
                <SidePanelField label="Open Invoices">
                  {selectedAccount.open_invoice_count}
                </SidePanelField>
                <SidePanelField label="Open Tasks">
                  {selectedAccount.open_task_count}
                </SidePanelField>
              </div>

              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Account Status
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[var(--color-text-muted)]">
                  <span>Worst ageing bucket</span>
                  <StatusTag status={selectedAccount.worst_bucket} />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm text-[var(--color-text-muted)]">
                  <span>Active exception count</span>
                  <span className="font-semibold text-[var(--color-text)]">
                    {selectedAccount.active_exception_count}
                  </span>
                </div>
              </div>
            </SidePanel>
          ) : (
            <SidePanel title="No party selected">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a party from the register to inspect exposure, task
                load, and workflow paths here.
              </p>
            </SidePanel>
          )}

          <Panel>
            <PanelHeader title="Linked Workflows">
              Route the selected party into active review surfaces.
            </PanelHeader>
            {selectedAccount ? (
              <div className="space-y-2 p-4">
                {[
                  [
                    "Invoices",
                    `/invoices?party_canonical_id=${selectedAccount.canonical_id}`,
                  ],
                  [
                    "Tasks",
                    `/tasks?canonical_id=${selectedAccount.canonical_id}`,
                  ],
                  [
                    "Promises",
                    `/promises-to-pay?canonical_id=${selectedAccount.canonical_id}`,
                  ],
                  [
                    "Party page",
                    `/party/${selectedAccount.canonical_id}`,
                  ],
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
                Select a party to open invoices, tasks, promises, and the full
                party record.
              </div>
            )}
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
