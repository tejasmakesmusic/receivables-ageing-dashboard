import Link from "next/link";
import { Download, Filter, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { ProgressBar } from "@/components/ui/mini-chart";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { assertNotPending } from "@/server/core/assertNotPending";
import { requirePageRole } from "@/server/core/page-auth";
import { getDashboard } from "@/server/dashboard/service";
import {
  DashboardError,
  type DashboardEntity,
  type DashboardResponse,
} from "@/server/dashboard/types";

export const dynamic = "force-dynamic";

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const buckets = [
  { key: "NOT_DUE", label: "Current" },
  { key: "0_30", label: "1-30 Days" },
  { key: "31_60", label: "31-60 Days" },
  { key: "61_90", label: "61-90 Days" },
  { key: "90_PLUS", label: "91+ Days" },
] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseEntity(
  value: string | undefined,
  fallback: DashboardEntity,
): DashboardEntity {
  return value === "IND" || value === "UAE" || value === "ALL"
    ? value
    : fallback;
}

async function analystEntity(user: {
  entityIdScope: string | null;
  role: role_enum;
}): Promise<DashboardEntity | null> {
  if (user.role !== role_enum.ANALYST) {
    return "ALL";
  }

  if (!user.entityIdScope) {
    return null;
  }

  const entity = await getPrisma().entities.findUnique({
    where: { id: user.entityIdScope },
    select: { code: true },
  });

  return entity?.code === "IND" || entity?.code === "UAE"
    ? entity.code
    : null;
}

function overdueAmount(dashboard: DashboardResponse) {
  return (
    dashboard.ageing_buckets["0_30"] +
    dashboard.ageing_buckets["31_60"] +
    dashboard.ageing_buckets["61_90"] +
    dashboard.ageing_buckets["90_PLUS"]
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const user = await requirePageRole(
    "/reports",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  const raw = await searchParams;
  const forcedEntity = await analystEntity(user);
  const entity =
    forcedEntity && user.role === role_enum.ANALYST
      ? forcedEntity
      : parseEntity(first(raw.entity), forcedEntity ?? "ALL");
  const asOf = first(raw.as_of) ?? "latest";
  let dashboard: DashboardResponse | null = null;
  let dashboardError: DashboardError | null = null;

  if (forcedEntity) {
    try {
      dashboard = await getDashboard({ as_of: asOf, entity });
    } catch (error) {
      if (error instanceof DashboardError) {
        dashboardError = error;
      } else {
        throw error;
      }
    }
  }

  const totalOutstanding = dashboard?.kpis.total_outstanding ?? 0;
  const currency = dashboard?.currency_display ?? "INR";
  const exportHref =
    entity === "ALL"
      ? "/api/reports/ageing"
      : `/api/reports/ageing?entity=${entity}`;

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white hover:bg-[var(--color-accent-strong)]"
            href={exportHref}
          >
            <Download className="h-4 w-4" />
            Export Ageing
          </Link>
        }
        title="Reports"
      >
        Executive AR performance, ageing exposure, risk parties, and exports.
      </PageHeader>

      <Panel>
        <form action="/reports" className="grid gap-3 p-4 md:grid-cols-[200px_200px_1fr]">
          <select
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            defaultValue={entity}
            disabled={user.role === role_enum.ANALYST}
            name="entity"
          >
            <option value="ALL">All entities</option>
            <option value="IND">India</option>
            <option value="UAE">UAE</option>
          </select>
          <select
            className="h-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            defaultValue={asOf}
            name="as_of"
          >
            <option value="latest">Latest snapshot</option>
          </select>
          <Button className="justify-self-start" type="submit" variant="secondary">
            <Filter className="h-4 w-4" />
            Apply
          </Button>
        </form>
      </Panel>

      {!dashboard ? (
        <EmptyState
          action={
            <Link
              className="text-sm font-medium text-[var(--color-accent)]"
              href="/upload"
            >
              Upload snapshot
            </Link>
          }
          description={
            dashboardError?.message ??
            "No reportable dashboard data is available for this role and entity."
          }
          title="Reports unavailable"
        />
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Total Outstanding"
              meta={`Snapshot ${formatDate(dashboard.as_of_date)}`}
              value={formatCurrency(totalOutstanding, currency)}
            />
            <MetricCard
              label="Overdue Share"
              meta="Based on published ageing snapshot"
              value={`${dashboard.kpis.pct_overdue.toFixed(1)}%`}
            />
            <MetricCard
              label="90+ Parties"
              meta="Parties with 91+ day exposure"
              value={dashboard.kpis.parties_with_90plus_count}
            />
            <MetricCard
              label="Default Credit Period"
              meta="Parties currently on default terms"
              value={dashboard.parties_on_default_credit_period_count}
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <Panel>
                <PanelHeader title="Ageing Waterfall">
                  Outstanding by ageing bucket from the published snapshot.
                </PanelHeader>
                <div className="space-y-4 p-4">
                  {buckets.map((bucket) => {
                    const amount = dashboard.ageing_buckets[bucket.key];
                    const percent =
                      totalOutstanding > 0
                        ? Math.round((amount / totalOutstanding) * 100)
                        : 0;

                    return (
                      <div className="grid gap-3 md:grid-cols-[130px_1fr_140px]" key={bucket.key}>
                        <div className="flex items-center gap-2">
                          <StatusTag status={bucket.key} />
                          <span className="text-sm text-[var(--color-text)]">
                            {bucket.label}
                          </span>
                        </div>
                        <div className="self-center">
                          <ProgressBar value={percent} />
                        </div>
                        <div className="text-right text-sm font-semibold text-[var(--color-text)]">
                          {formatCurrency(amount, currency)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Top Risk Parties">
                  Ordered by outstanding exposure.
                </PanelHeader>
                <TableShell>
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-4 py-3">Account</th>
                        <th className="px-4 py-3">Bucket</th>
                        <th className="px-4 py-3 text-right">Outstanding</th>
                        <th className="px-4 py-3 text-right">Exceptions</th>
                        <th className="px-4 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {dashboard.top_parties.length === 0 ? (
                        <EmptyTableRow colSpan={5}>
                          <EmptyState
                            description="Risk parties appear after open receivables are present in the published snapshot."
                            title="No risk parties"
                          />
                        </EmptyTableRow>
                      ) : (
                        dashboard.top_parties.map((party) => (
                          <tr className="hover:bg-[var(--color-bg-subtle)]" key={party.canonical_id}>
                            <td className="px-4 py-3">
                              <Link
                                className="font-medium text-[var(--color-accent)]"
                                href={`/party/${party.canonical_id}`}
                              >
                                {party.canonical_name}
                              </Link>
                            </td>
                            <td className="px-4 py-3">
                              <StatusTag status={party.overdue_bucket} />
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {formatCurrency(party.outstanding, currency)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {party.active_exception_count}
                            </td>
                            <td className="px-4 py-3">
                              <Link
                                className="font-medium text-[var(--color-accent)]"
                                href={`/party/${party.canonical_id}`}
                              >
                                Review
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
                <PanelHeader title="Executive Insights">
                  Snapshot {dashboard.as_of_date}
                </PanelHeader>
                <div className="space-y-4 p-4 text-sm">
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-success-soft)] p-3">
                    <div className="font-semibold text-[var(--color-text)]">
                      {formatCurrency(totalOutstanding, currency)} total AR
                    </div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      Current published view across {dashboard.entity}.
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-[var(--color-warning-soft)] p-3">
                    <div className="font-semibold text-[var(--color-text)]">
                      {formatCurrency(overdueAmount(dashboard), currency)} overdue
                    </div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      {dashboard.kpis.pct_overdue.toFixed(1)}% of outstanding AR.
                    </div>
                  </div>
                  {dashboard.kpis.fx_rate_used ? (
                    <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-3 text-[var(--color-text-muted)]">
                      Consolidated reports use invoice-date FX lookup. Last FX
                      rate applied: {dashboard.kpis.fx_rate_used}.
                    </div>
                  ) : null}
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Recent Exceptions">
                  Active exception tags.
                </PanelHeader>
                <div className="space-y-3 p-4">
                  {dashboard.recent_exceptions.length === 0 ? (
                    <EmptyState
                      description="Active exception tags will appear here."
                      title="No active exceptions"
                    />
                  ) : (
                    dashboard.recent_exceptions.map((exception) => (
                      <Link
                        className="block rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 hover:border-[var(--color-accent)]"
                        href={`/invoice/${exception.invoice_id}`}
                        key={exception.exception_id}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-[var(--color-accent)]" />
                          <span className="text-sm font-semibold text-[var(--color-text)]">
                            {exception.invoice_ref}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {exception.bucket_type_name} - {exception.canonical_name}
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </Panel>
            </RightRail>
          </div>
        </>
      )}
    </PageFrame>
  );
}
