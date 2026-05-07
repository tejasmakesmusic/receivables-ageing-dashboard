import Link from "next/link";
import { ArrowRight, Building2, Upload } from "lucide-react";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  SavedViewLink,
  SavedViewTabs,
  RightRail,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency } from "@/lib/format";
import { listAccounts } from "@/server/accounts/service";
import { requirePageRole } from "@/server/core/page-auth";

export const dynamic = "force-dynamic";

type AccountsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type AccountView = "all" | "high-risk" | "watch" | "india" | "uae";

function first(value: string | string[] | undefined) {
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
  return view === "all" ? "/accounts" : `/accounts?view=${view}`;
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const user = await requirePageRole(
    "/accounts",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  const params = await searchParams;
  const accounts = await listAccounts(user);
  const activeView = parseAccountView(first(params.view));
  const visibleAccounts = accounts.filter((account) => {
    if (activeView === "high-risk") return account.collection_health === "At Risk";
    if (activeView === "watch") return account.collection_health === "Watch";
    if (activeView === "india") return account.entity_code.toUpperCase() === "IND";
    if (activeView === "uae") return account.entity_code.toUpperCase() === "UAE";
    return true;
  });
  const selectedId = first(params.account);
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

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/upload"
            >
              <Upload className="h-4 w-4" />
              Upload Snapshot
            </Link>
          </>
        }
        title="Accounts"
      >
        Manage customer relationships and monitor account health.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Visible Accounts" meta="Current account view" value={visibleAccounts.length} />
        <MetricCard label="High Risk Accounts" meta="90+ or active exceptions" value={highRiskCount} />
        <MetricCard label="Watch Accounts" meta="31-90 day exposure" value={watchCount} />
        <MetricCard label="Open Invoices" meta="Across visible accounts" value={openInvoiceCount} />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <SavedViewTabs>
            <SavedViewLink active={activeView === "all"} href={viewHref("all")}>
              All Accounts
            </SavedViewLink>
            <SavedViewLink active={activeView === "high-risk"} href={viewHref("high-risk")}>High Risk</SavedViewLink>
            <SavedViewLink active={activeView === "watch"} href={viewHref("watch")}>Watch</SavedViewLink>
            <SavedViewLink active={activeView === "india"} href={viewHref("india")}>India</SavedViewLink>
            <SavedViewLink active={activeView === "uae"} href={viewHref("uae")}>UAE</SavedViewLink>
          </SavedViewTabs>

          <Panel className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4 text-sm">
              <div>
                <div className="font-semibold text-[var(--color-text)]">
                  Account Register
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Showing {visibleAccounts.length} of {accounts.length} canonical parties.
                </div>
              </div>
              <Link
                className="inline-flex items-center gap-2 font-medium text-[var(--color-accent)]"
                href="/config"
              >
                Manage aliases
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <TableShell>
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Account Name</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3 text-right">Total Outstanding</th>
                    <th className="px-4 py-3 text-right">Overdue</th>
                    <th className="px-4 py-3 text-right">Open Invoices</th>
                    <th className="px-4 py-3">Worst Bucket</th>
                    <th className="px-4 py-3">Collection Health</th>
                    <th className="px-4 py-3">Next Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {visibleAccounts.length === 0 ? (
                    <EmptyTableRow colSpan={8}>
                      <EmptyState
                        action={
                          <Link
                            className="text-sm font-medium text-[var(--color-accent)]"
                            href="/upload"
                          >
                            Upload workbook
                          </Link>
                        }
                        description="Change the saved view or upload a workbook to expand the visible account set."
                        title="No accounts match this view"
                      />
                    </EmptyTableRow>
                  ) : (
                    visibleAccounts.map((account) => (
                      <tr
                        className={[
                          "transition-colors hover:bg-[var(--color-bg-subtle)]",
                          selectedAccount?.canonical_id === account.canonical_id
                            ? "bg-[var(--color-accent-soft)]"
                            : "",
                        ].join(" ")}
                        key={account.canonical_id}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                              <Building2 className="h-4 w-4" />
                            </div>
                            <div>
                              <Link
                                className="font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
                                href={`/accounts?account=${account.canonical_id}`}
                              >
                                {account.canonical_name}
                              </Link>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {account.canonical_id.slice(0, 8)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {account.entity_code}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(
                            account.total_outstanding,
                            account.currency_display,
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {formatCurrency(
                            account.overdue_amount,
                            account.currency_display,
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {account.open_invoice_count}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={account.worst_bucket} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag
                            label={account.collection_health}
                            status={healthStatus(account.collection_health)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
                            href={`/party/${account.canonical_id}`}
                          >
                            View Account
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableShell>
          </Panel>
        </div>

        <RightRail>
          <Panel>
            <PanelHeader title="Account Preview">
              {selectedAccount
                ? selectedAccount.canonical_id.slice(0, 8)
                : "No account selected"}
            </PanelHeader>
            {selectedAccount ? (
              <div className="space-y-4 p-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">
                    {selectedAccount.canonical_name}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusTag status={selectedAccount.worst_bucket} />
                    <StatusTag
                      label={selectedAccount.collection_health}
                      status={healthStatus(selectedAccount.collection_health)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Outstanding
                    </div>
                    <div className="mt-1 font-semibold">
                      {formatCurrency(
                        selectedAccount.total_outstanding,
                        selectedAccount.currency_display,
                      )}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
                    <div className="text-xs text-[var(--color-text-muted)]">
                      Open Invoices
                    </div>
                    <div className="mt-1 font-semibold">
                      {selectedAccount.open_invoice_count}
                    </div>
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-muted)]">
                  Open the account detail page for invoice, follow-up, promise,
                  and dispute context tied to this canonical party.
                </div>
                <Link
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
                  href={`/party/${selectedAccount.canonical_id}`}
                >
                  View Full Account
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  description="Select an account row to preview outstanding exposure and next actions."
                  title="No account selected"
                />
              </div>
            )}
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
