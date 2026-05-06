import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import type { DashboardResponse } from "@/server/dashboard/types";
import { DashboardError } from "@/server/dashboard/types";
import { getDashboard } from "@/server/dashboard/service";
import { requirePageRole } from "@/server/core/page-auth";
import { assertAnalystCanAccessEntityCode } from "@/server/core/scope";
import { AgeingBucketsChart } from "@/components/charts/ageing-buckets-chart";
import { StatusTag } from "@/components/ui/status-tag";
import { formatCurrency, formatDate } from "@/lib/format";

const AGEING_BUCKET_CHART = [
  { key: "NOT_DUE", label: "Not Due" },
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
            <p className="text-sm text-slate-600">
              {dashboardError?.message || "No dashboard data available."}
            </p>
            <p className="text-xs text-slate-500">
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

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
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
              {formatCurrency(
                dashboard.kpis.total_outstanding,
                dashboard.currency_display,
              )}
            </p>
            <p className="text-sm text-slate-500">
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
            <p className="text-sm text-slate-500">
              Parties over 90+ days: {dashboard.kpis.parties_with_90plus_count}
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
            <p className="text-sm text-slate-500">
              Parties currently on default credit terms
            </p>
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
              <p className="text-sm text-slate-500">No active exceptions.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {dashboard.recent_exceptions.map((item) => (
                  <li
                    className="rounded border border-slate-200 p-2"
                    key={item.exception_id}
                  >
                    <div className="font-medium">{item.invoice_ref}</div>
                    <div className="text-slate-500">
                      {item.bucket_type_name} - {item.canonical_name}
                    </div>
                    <div className="text-xs text-slate-400">
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

      <section>
        <Card>
          <CardHeader>
            <CardTitle>Top Parties</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {dashboard.top_parties.length === 0 ? (
                <p className="text-slate-500">No outstanding parties.</p>
              ) : (
                dashboard.top_parties.map((party) => (
                  <div
                    className="flex items-center justify-between rounded border border-slate-200 p-3"
                    key={party.canonical_id}
                  >
                    <div>
                      <div className="font-medium">{party.canonical_name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <StatusTag status={party.overdue_bucket} />
                        <span>
                          {party.active_exception_count} active exception(s)
                        </span>
                      </div>
                    </div>
                    <div className="font-medium">
                      {formatCurrency(
                        party.outstanding,
                        dashboard.currency_display,
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
