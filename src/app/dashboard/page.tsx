import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import type { DashboardResponse } from "@/server/dashboard/types";
import { DashboardError } from "@/server/dashboard/types";
import { getDashboard } from "@/server/dashboard/service";
import { getPrisma } from "@/lib/prisma";
import { requirePageRole } from "@/server/core/page-auth";
import { assertAnalystCanAccessEntityCode } from "@/server/core/scope";
import { AgeingBucketsChart } from "@/components/charts/ageing-buckets-chart";
import { TopPartiesChart } from "@/components/charts/top-parties-chart";
import { StatusTag } from "@/components/ui/status-tag";
import { formatCurrencyCompact, formatDate } from "@/lib/format";

const AGEING_BUCKET_CHART = [
  { key: "NOT_DUE", label: "Not Due" },
  { key: "DUE_TODAY", label: "Due Today" },
  { key: "0_30", label: "0-30" },
  { key: "31_60", label: "31-60" },
  { key: "61_90", label: "61-90" },
  { key: "90_PLUS", label: "90+" },
] as const;

export default async function DashboardPage() {
  const currentUser = await requirePageRole(
    "/dashboard",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  await assertAnalystCanAccessEntityCode(currentUser, "IND");

  let dashboard: DashboardResponse | null = null;
  let dashboardError: DashboardError | null = null;

  try {
    dashboard = await getDashboard({ entity: "IND", as_of: "latest" });
  } catch (error) {
    if (error instanceof DashboardError) {
      dashboardError = error;
    } else {
      throw error;
    }
  }

  if (!dashboard) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <Card>
          <CardHeader>
            <CardTitle>Dashboard Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-text-muted)]">
              {dashboardError?.message || "No dashboard data available."}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {dashboardError ? JSON.stringify(dashboardError.detail) : null}
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const ageingBuckets = AGEING_BUCKET_CHART.map((bucket) => ({
    bucket: bucket.key,
    label: bucket.label,
    value: dashboard.ageing_buckets[bucket.key],
  }));

  // PR 3 / Gap 3 — count unacked invoice_changes tied to the snapshot the
  // dashboard is showing. One read; cheap (indexed). Drives the
  // "Changes Detected" KPI card.
  const unackedChangesCount = await getPrisma().invoice_changes.count({
    where: {
      snapshot_id: dashboard.snapshot_id,
      acknowledged_at: null,
    },
  });

  // PR 4 — source-quality widget data. Latest snapshot row per non-CREDIT
  // source for the dashboard's entity, plus the count of STAGED snapshots
  // (useful "queue depth" indicator).
  const entityRow = await getPrisma().entities.findUnique({
    where: { code: dashboard.entity === "ALL" ? "IND" : dashboard.entity },
    select: { id: true },
  });
  const sourceFreshness = entityRow
    ? await Promise.all(
        ["TALLY", "XERO"].map(async (source) => {
          const latest = await getPrisma().snapshots.findFirst({
            where: {
              entity_id: entityRow.id,
              source_hint: source,
              status: "PUBLISHED",
            },
            orderBy: { published_at: "desc" },
            select: {
              id: true,
              uploaded_at: true,
              published_at: true,
              as_of_date: true,
              row_count: true,
            },
          });
          const stagedCount = await getPrisma().snapshots.count({
            where: {
              entity_id: entityRow.id,
              source_hint: source,
              status: "STAGED",
            },
          });
          return { source, latest, stagedCount };
        }),
      )
    : [];

  // PR 4 — invoice count per top-party for the chart tooltip.
  const ninetyPlusAmount = dashboard.ageing_buckets["90_PLUS"] ?? 0;
  const topPartiesData = dashboard.top_parties.map((party) => ({
    canonical_id: party.canonical_id,
    name: party.canonical_name,
    outstanding: party.outstanding,
    bucket: party.overdue_bucket,
  }));

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <span>
            Entity: {dashboard.entity} - Snapshot {dashboard.as_of_date}
          </span>
          <StatusTag status={dashboard.snapshot_status} />
        </p>
      </section>

      <section className="card-grid">
        <Card>
          <CardHeader>
            <CardTitle>Total Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {formatCurrencyCompact(
                dashboard.kpis.total_outstanding,
                dashboard.currency_display,
              )}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Snapshot ID: {dashboard.snapshot_id}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overdue Share</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {dashboard.kpis.pct_overdue.toFixed(2)}%
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              of total receivables overdue
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>90+ Days Overdue</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-[var(--color-status-danger-text)]">
              {formatCurrencyCompact(ninetyPlusAmount, dashboard.currency_display)}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              {dashboard.kpis.parties_with_90plus_count}{" "}
              {dashboard.kpis.parties_with_90plus_count === 1
                ? "party"
                : "parties"}{" "}
              ·{" "}
              <Link
                className="text-[var(--color-accent)] hover:underline"
                href="/invoices?overdue_bucket=90_PLUS"
              >
                review
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Default Credit Period</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {dashboard.parties_on_default_credit_period_count}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Parties currently on default credit terms
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Changes Detected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{unackedChangesCount}</p>
            {unackedChangesCount > 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Field drifts in this snapshot —{" "}
                <Link
                  className="text-[var(--color-accent)] hover:underline"
                  href="/invoices?change_status=changed"
                >
                  review
                </Link>
              </p>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)]">
                No unacknowledged field drifts in this snapshot
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Ageing Buckets</CardTitle>
          </CardHeader>
          <CardContent>
            <AgeingBucketsChart buckets={ageingBuckets} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Exceptions</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.recent_exceptions.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No active exceptions.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {dashboard.recent_exceptions.map((item) => (
                  <li
                    className="rounded border border-[var(--color-border)] p-2"
                    key={item.exception_id}
                  >
                    <div className="font-medium">{item.invoice_ref}</div>
                    <div className="text-[var(--color-text-muted)]">
                      {item.bucket_type_name} - {item.canonical_name}
                    </div>
                    <div className="text-xs text-[var(--color-text-subtle)]">
                      {formatDate(item.expected_resolution_date)} - tagged{" "}
                      {formatDate(item.tagged_at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Top Parties by Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <TopPartiesChart data={topPartiesData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Source Quality</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceFreshness.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Entity not found.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {sourceFreshness.map((row) => (
                  <li
                    className="rounded border border-[var(--color-border)] p-3"
                    key={row.source}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--color-text)]">
                        {row.source}
                      </span>
                      {row.latest ? (
                        <StatusTag status="GATE_OK" />
                      ) : (
                        <StatusTag status="NO_DATA" />
                      )}
                    </div>
                    {row.latest ? (
                      <div className="mt-2 grid gap-1 text-xs text-[var(--color-text-muted)]">
                        <span>
                          Latest as-of:{" "}
                          <span className="text-[var(--color-text)]">
                            {row.latest.as_of_date
                              ? formatDate(row.latest.as_of_date.toISOString())
                              : "—"}
                          </span>
                        </span>
                        <span>
                          Published:{" "}
                          {row.latest.published_at
                            ? formatDate(
                                row.latest.published_at.toISOString(),
                              )
                            : "—"}{" "}
                          · {row.latest.row_count ?? 0} rows
                        </span>
                        {row.stagedCount > 0 ? (
                          <span className="text-[var(--color-status-warning-text)]">
                            {row.stagedCount} staged awaiting publish
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                        No published snapshots yet.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              <Link
                className="text-[var(--color-accent)] hover:underline"
                href="/snapshots"
              >
                View all snapshots →
              </Link>
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
