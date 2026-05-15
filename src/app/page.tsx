import Link from "next/link";
import { ArrowRight, CalendarCheck, Mail, Phone, Plus, RefreshCw } from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { MiniSparkline, ProgressBar } from "@/components/ui/mini-chart";
import {
  EmptyState,
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  ProgressRing,
  RightRail,
} from "@/components/ui/workspace";
import { formatCurrencyCompact, formatDate } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import {
  FOCUS_QUEUE_PAGE_ROLES,
  type FocusQueueItem,
} from "@/server/focus/service";
import { getHomeCommandCenter } from "@/server/home/service";

export const dynamic = "force-dynamic";

function queueTypeLabel(type: FocusQueueItem["type"]) {
  switch (type) {
    case "TASK":
      return "Task";
    case "PTP":
      return "Promise";
    case "DISPUTE":
      return "Dispute";
    case "STAGING_BLOCKER":
      return "Staging";
    case "RECONCILIATION":
      return "Tie-out";
  }
}

function nextActionLabel(item: FocusQueueItem) {
  if (item.type === "PTP") return "Review promise follow-up";
  if (item.type === "DISPUTE") return "Resolve dispute blocker";
  if (item.type === "STAGING_BLOCKER") return "Resolve staging blocker";
  if (item.type === "RECONCILIATION") return "Review reconciliation mismatch";
  if (item.status.includes("SNOOZED")) return "Review snoozed task";
  return "Open collection task";
}

function overdueAmount(dashboard: NonNullable<Awaited<ReturnType<typeof getHomeCommandCenter>>["dashboard"]>) {
  return (
    dashboard.ageing_buckets["0_30"] +
    dashboard.ageing_buckets["31_60"] +
    dashboard.ageing_buckets["61_90"] +
    dashboard.ageing_buckets["90_PLUS"]
  );
}

export default async function HomePage() {
  const user = await requirePageRole("/", ...FOCUS_QUEUE_PAGE_ROLES);
  const home = await getHomeCommandCenter(user);
  const dashboard = home.dashboard;
  const dashboardCurrency = dashboard?.currency_display ?? "INR";

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
            href="/dashboard"
          >
            <RefreshCw className="h-4 w-4" />
            View Dashboard
          </Link>
        }
        title="Today's Focus"
      >
        Prioritize the highest-risk receivables first.
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          accent={<MiniSparkline />}
          label="Total Outstanding"
          meta={
            dashboard
              ? `Snapshot ${formatDate(dashboard.as_of_date)}`
              : "Waiting for published snapshot"
          }
          value={
            dashboard
              ? formatCurrencyCompact(dashboard.kpis.total_outstanding, dashboardCurrency)
              : "-"
          }
        />
        <MetricCard
          accent={<MiniSparkline color="var(--color-danger)" />}
          label="Overdue"
          meta={dashboard ? `${dashboard.kpis.pct_overdue.toFixed(1)}% of AR` : "No ageing yet"}
          value={
            dashboard ? formatCurrencyCompact(overdueAmount(dashboard), dashboardCurrency) : "-"
          }
        />
        <MetricCard
          accent={<StatusTag status="90_PLUS" />}
          label="90+ Parties"
          meta="Parties needing senior attention"
          value={dashboard?.kpis.parties_with_90plus_count ?? "-"}
        />
        <MetricCard
          accent={home.is_read_only ? <StatusTag status="READ_ONLY" /> : null}
          label="Focus Items"
          meta={`${home.focus_total} open item${home.focus_total === 1 ? "" : "s"}`}
          value={home.focus_items.length}
        />
        <MetricCard
          label="Default Credit Terms"
          meta="Needs policy review if unexpected"
          value={dashboard?.parties_on_default_credit_period_count ?? "-"}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel>
            <PanelHeader
              action={
                <Link
                  className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]"
                  href="/focus"
                >
                  View All
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
              title="Critical Work Queue"
            >
              Start here: overdue, blocked, disputed, and tie-out work ranked by urgency.
            </PanelHeader>

            {home.focus_items.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  action={
                    <Link
                      className="text-sm font-medium text-[var(--color-accent)]"
                      href="/invoices"
                    >
                      View invoices
                    </Link>
                  }
                  description="Open invoices, staging blockers, broken promises, and reconciliation mismatches will appear here."
                  title="No focus items in your scope"
                />
              </div>
            ) : (
              <TableShell>
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-4 py-3">Work Item</th>
                      <th className="px-4 py-3">Entity</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Due</th>
                      <th className="px-4 py-3">Next Best Action</th>
                      <th className="px-4 py-3 text-right">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {home.focus_items.map((item) => (
                      <tr
                        className="transition-colors hover:bg-[var(--color-bg-subtle)]"
                        key={`${item.type}-${item.id}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                                {queueTypeLabel(item.type)}
                              </span>
                              <Link
                                className="font-medium text-[var(--color-accent)] hover:underline"
                                href={item.href}
                              >
                                {item.title}
                              </Link>
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {item.subtitle}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {item.entity_code}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag status={item.status} />
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {item.due_date ? formatDate(item.due_date) : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
                            href={item.href}
                          >
                            {nextActionLabel(item)}
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-[var(--color-text)]">
                          {item.priority_score.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableShell>
            )}
          </Panel>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel className="p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Ageing Summary
              </h2>
              {dashboard ? (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-5 overflow-hidden rounded-full text-[10px] font-medium text-white">
                    {(["NOT_DUE", "0_30", "31_60", "61_90", "90_PLUS"] as const).map(
                      (bucket) => {
                        const value = dashboard.ageing_buckets[bucket];
                        const total = Math.max(dashboard.kpis.total_outstanding, 1);
                        const percent = Math.max(4, Math.round((value / total) * 100));
                        const colors: Record<typeof bucket, string> = {
                          NOT_DUE: "bg-[var(--color-success)]",
                          "0_30": "bg-[var(--color-accent)]",
                          "31_60": "bg-[var(--color-warning)]",
                          "61_90": "bg-orange-500",
                          "90_PLUS": "bg-red-500",
                        };
                        return (
                          <div
                            className={`${colors[bucket]} py-2 text-center`}
                            key={bucket}
                            style={{ width: `${percent}%` }}
                          >
                            {percent}%
                          </div>
                        );
                      },
                    )}
                  </div>
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    {Object.entries(dashboard.ageing_buckets).map(([bucket, amount]) => (
                      <div key={bucket}>
                        <StatusTag status={bucket} />
                        <div className="mt-1 font-semibold text-[var(--color-text)]">
                          {formatCurrencyCompact(amount, dashboardCurrency)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState
                  action={
                    <Link
                      className="text-sm font-medium text-[var(--color-accent)]"
                      href="/upload"
                    >
                      Upload workbook
                    </Link>
                  }
                  description={home.dashboard_error ?? "No published dashboard data is available yet."}
                  title="Publish a snapshot to calculate ageing"
                />
              )}
            </Panel>

            <Panel className="p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Focus Forecast
              </h2>
              <div className="mt-4 space-y-4">
                <ProgressBar value={home.daily_goal.percent} />
                <div className="text-3xl font-semibold text-[var(--color-text)]">
                  {home.daily_goal.remaining}
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  controllable actions remaining in today&apos;s goal.
                </p>
                <Link
                  className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-accent)]"
                  href="/focus"
                >
                  Open focus queue
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Panel>

            <Panel className="p-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">
                Top Overdue Parties
              </h2>
              {dashboard?.top_parties.length ? (
                <ol className="mt-4 space-y-3 text-sm">
                  {dashboard.top_parties.slice(0, 5).map((party, index) => (
                    <li
                      className="flex items-center justify-between gap-3"
                      key={party.canonical_id}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--color-text)]">
                          {index + 1}. {party.canonical_name}
                        </div>
                        <StatusTag status={party.overdue_bucket} />
                      </div>
                      <div className="text-right font-medium text-[var(--color-text)]">
                        {formatCurrencyCompact(party.outstanding, dashboardCurrency)}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  description="Top overdue parties appear after a published snapshot is available."
                  title="No overdue account ranking"
                />
              )}
            </Panel>
          </div>
        </div>

        <RightRail>
          <Panel className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text)]">
                  Daily Goal
                </h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Controllable actions, not cash collected.
                </p>
              </div>
              <ProgressRing label="complete" value={home.daily_goal.percent} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xl font-semibold text-[var(--color-text)]">
                  {home.daily_goal.completed} / {home.daily_goal.target}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  actions completed
                </div>
              </div>
              <div>
                <div className="text-xl font-semibold text-[var(--color-text)]">
                  {home.daily_goal.remaining}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  remaining
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Reminders & Nudges">
              Actionable, snoozable work only.
            </PanelHeader>
            <div className="divide-y divide-[var(--color-border)]">
              {home.nudges.map((nudge) => (
                <Link
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-bg-subtle)]"
                  href={nudge.href}
                  key={nudge.title}
                >
                  <span
                    className={[
                      "mt-0.5 h-2.5 w-2.5 rounded-full",
                      nudge.tone === "success"
                        ? "bg-[var(--color-success)]"
                        : nudge.tone === "warning"
                          ? "bg-[var(--color-warning)]"
                          : "bg-[var(--color-accent)]",
                    ].join(" ")}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--color-text)]">
                      {nudge.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                      {nudge.description}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel className="p-4">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Quick Actions
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { href: "/tasks", label: "New Task", icon: Plus },
                { href: "/follow-ups", label: "Log Follow-up", icon: Phone },
                { href: "/promises-to-pay", label: "Create Promise", icon: CalendarCheck },
                { href: "/reconciliation", label: "Review Tie-Out", icon: Mail },
              ].map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 text-xs font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
                    href={action.href}
                    key={action.href}
                  >
                    <Icon className="h-4 w-4 text-[var(--color-accent)]" />
                    {action.label}
                  </Link>
                );
              })}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Recent Exceptions">
              Latest active control exceptions.
            </PanelHeader>
            <TableShell>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-[var(--color-border)]">
                  {dashboard?.recent_exceptions.length ? (
                    dashboard.recent_exceptions.map((item) => (
                      <tr key={item.exception_id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--color-text)]">
                            {item.invoice_ref}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {item.bucket_type_name} - {item.canonical_name}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <EmptyTableRow colSpan={1}>
                      No active exceptions in the current view.
                    </EmptyTableRow>
                  )}
                </tbody>
              </table>
            </TableShell>
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
