import Link from "next/link";
import {
  ActivityIcon,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  FileWarning,
  GitCompare,
  Layers,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageFrame, PageHeader } from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import type {
  DashboardEntity,
  DashboardResponse,
} from "@/server/dashboard/types";
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

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isEntityCode(value: string | undefined): value is DashboardEntity {
  return value === "IND" || value === "UAE" || value === "ALL";
}

/**
 * Resolve which entity the dashboard should show. Honoring role scope:
 *   • ANALYST → their own entity (never "ALL")
 *   • CFO / REVIEWER / ADMIN → the ?entity= query param, defaulting to
 *     "ALL" so the consolidated view is the first thing they see.
 */
async function resolveEntity(
  user: { role: role_enum; entityIdScope: string | null },
  raw: string | undefined,
): Promise<DashboardEntity> {
  if (user.role === role_enum.ANALYST) {
    if (!user.entityIdScope) return "IND"; // unreachable: analyst always scoped
    const entity = await getPrisma().entities.findUnique({
      where: { id: user.entityIdScope },
      select: { code: true },
    });
    return entity?.code === "UAE" ? "UAE" : "IND";
  }
  if (isEntityCode(raw)) return raw;
  return "ALL";
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const currentUser = await requirePageRole(
    "/dashboard",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  const raw = await searchParams;
  const entity = await resolveEntity(currentUser, first(raw.entity));

  // ANALYST scope check (skips when entity is "ALL" or matches their scope).
  if (entity !== "ALL") {
    await assertAnalystCanAccessEntityCode(currentUser, entity);
  }

  let dashboard: DashboardResponse | null = null;
  let dashboardError: DashboardError | null = null;
  try {
    dashboard = await getDashboard({ entity, as_of: "latest" });
  } catch (error) {
    if (error instanceof DashboardError) {
      dashboardError = error;
    } else {
      throw error;
    }
  }

  // PR C+ — instead of dumping the raw error, render a real onboarding
  // empty state that tells the analyst what's missing and where to go.
  if (!dashboard) {
    return (
      <DashboardEmptyState
        entity={entity}
        error={dashboardError}
        showSwitcher={currentUser.role !== role_enum.ANALYST}
      />
    );
  }

  const ageingBuckets = AGEING_BUCKET_CHART.map((bucket) => ({
    bucket: bucket.key,
    label: bucket.label,
    value: dashboard.ageing_buckets[bucket.key],
  }));

  const [unackedChangesCount, entityRow] = await Promise.all([
    getPrisma().invoice_changes.count({
      where: {
        snapshot_id: dashboard.snapshot_id,
        acknowledged_at: null,
      },
    }),
    getPrisma().entities.findUnique({
      where: { code: dashboard.entity === "ALL" ? "IND" : dashboard.entity },
      select: { id: true },
    }),
  ]);

  const sourceFreshness = entityRow
    ? await Promise.all(
        ["TALLY", "XERO"].map(async (source) => {
          const [latest, stagedCount] = await Promise.all([
            getPrisma().snapshots.findFirst({
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
            }),
            getPrisma().snapshots.count({
              where: {
                entity_id: entityRow.id,
                source_hint: source,
                status: "STAGED",
              },
            }),
          ]);
          return { source, latest, stagedCount };
        }),
      )
    : [];

  const ninetyPlusAmount = dashboard.ageing_buckets["90_PLUS"] ?? 0;
  const overdueShare = dashboard.kpis.pct_overdue;
  const stagedSnapshotCount = sourceFreshness.reduce(
    (sum, source) => sum + source.stagedCount,
    0,
  );
  const criticalWorkItems = [
    {
      label: "Review 90+ overdue invoices",
      count: dashboard.kpis.parties_with_90plus_count,
      detail: `${formatCurrencyCompact(
        ninetyPlusAmount,
        dashboard.currency_display,
      )} at highest ageing risk`,
      href: `/invoices?overdue_bucket=90_PLUS${entity !== "ALL" ? `&entity=${entity}` : ""}`,
      status: "90_PLUS",
    },
    {
      label: "Resolve active exceptions",
      count: dashboard.recent_exceptions.length,
      detail: "Blocked invoices need an owner and next step",
      href: "/exceptions",
      status:
        dashboard.recent_exceptions.length > 0 ? "STAGING_BLOCKED" : "NO_DATA",
    },
    {
      label: "Review changed invoice fields",
      count: unackedChangesCount,
      detail: "Acknowledge snapshot drifts before they surprise operators",
      href: "/invoices?change_status=changed",
      status: unackedChangesCount > 0 ? "NEEDS_REVIEW" : "NO_DATA",
    },
    {
      label: "Publish staged workbooks",
      count: stagedSnapshotCount,
      detail: "Staged snapshots do not affect AR until published",
      href: "/snapshots?status=STAGED",
      status: stagedSnapshotCount > 0 ? "STAGED" : "PUBLISHED",
    },
  ];
  const topPartiesData = dashboard.top_parties.map((party) => ({
    canonical_id: party.canonical_id,
    name: party.canonical_name,
    outstanding: party.outstanding,
    bucket: party.overdue_bucket,
  }));

  return (
    <PageFrame>
      <PageHeader
        eyebrow={
          <span className="text-xs text-[var(--color-text-muted)]">
            Snapshot {formatDate(dashboard.as_of_date)} ·{" "}
            <StatusTag status={dashboard.snapshot_status} />
          </span>
        }
        title="Today's Receivables Priorities"
        actions={
          currentUser.role !== role_enum.ANALYST ? (
            <EntitySwitcher current={entity} />
          ) : null
        }
      >
        {entity === "ALL"
          ? "Consolidated receivables across every entity."
          : `Receivables for ${entity}, derived from the latest published snapshot.`}
      </PageHeader>

      <section
        className="grid gap-3 lg:grid-cols-4"
        aria-label="Critical work queue"
      >
        {criticalWorkItems.map((item) => (
          <WorkQueueCard key={item.label} {...item} />
        ))}
      </section>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="Receivables health summary"
      >
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Outstanding"
          meta={`As of ${formatDate(dashboard.as_of_date)}`}
          value={formatCurrencyCompact(
            dashboard.kpis.total_outstanding,
            dashboard.currency_display,
          )}
        />
        <KpiCard
          icon={<ActivityIcon className="h-4 w-4" />}
          label="Overdue Share"
          meta="of total receivables"
          tone={
            overdueShare >= 50
              ? "danger"
              : overdueShare >= 25
                ? "warning"
                : "neutral"
          }
          value={`${overdueShare.toFixed(1)}%`}
        />
        <KpiCard
          href={`/invoices?overdue_bucket=90_PLUS${entity !== "ALL" ? `&entity=${entity}` : ""}`}
          icon={<AlertTriangle className="h-4 w-4" />}
          label="90+ Days Overdue"
          meta={`${dashboard.kpis.parties_with_90plus_count} ${dashboard.kpis.parties_with_90plus_count === 1 ? "party" : "parties"} · review →`}
          tone="danger"
          value={formatCurrencyCompact(
            ninetyPlusAmount,
            dashboard.currency_display,
          )}
        />
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          label="Default Credit Period"
          meta="Parties on default terms"
          value={String(dashboard.parties_on_default_credit_period_count)}
        />
        <KpiCard
          href={
            unackedChangesCount > 0
              ? "/invoices?change_status=changed"
              : undefined
          }
          icon={<GitCompare className="h-4 w-4" />}
          label="Changes Detected"
          meta={
            unackedChangesCount > 0
              ? "Field drifts in this snapshot · review →"
              : "No unacknowledged drifts"
          }
          tone={unackedChangesCount > 0 ? "warning" : "neutral"}
          value={String(unackedChangesCount)}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Cash Risk by Ageing Bucket</CardTitle>
          </CardHeader>
          <CardContent>
            <AgeingBucketsChart buckets={ageingBuckets} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Blocked Invoices</CardTitle>
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
                href="/exceptions"
              >
                See all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.recent_exceptions.length === 0 ? (
              <div className="grid place-items-center gap-2 py-6 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]">
                  <FileWarning className="h-5 w-5" />
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  No active exceptions right now. New disputes or credit-note
                  blockers will appear here for review.
                </p>
              </div>
            ) : (
              <ul className="space-y-2 text-sm">
                {dashboard.recent_exceptions.map((item) => (
                  <li key={item.exception_id}>
                    <Link
                      className="block rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-subtle)]"
                      href={`/invoice/${item.invoice_id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-[var(--color-accent)]">
                          {item.invoice_ref}
                        </span>
                        <span className="text-xs text-[var(--color-text-subtle)]">
                          tagged {formatDate(item.tagged_at)}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-sm text-[var(--color-text)]">
                        {item.canonical_name}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        Blocked by {item.bucket_type_name}
                        {item.expected_resolution_date ? (
                          <>
                            {" · "}
                            <CalendarClock className="inline h-3 w-3" /> due{" "}
                            {formatDate(item.expected_resolution_date)}
                          </>
                        ) : null}
                      </div>
                    </Link>
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
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Largest Account Exposure</CardTitle>
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
                href="/parties"
              >
                See all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <TopPartiesChart data={topPartiesData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Source Readiness</CardTitle>
              <Link
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)] hover:underline"
                href="/snapshots"
              >
                Snapshots <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {sourceFreshness.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                No entity configured for this dashboard.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {sourceFreshness.map((row) => (
                  <li
                    className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3"
                    key={row.source}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--color-text)]">
                        {row.source}
                      </span>
                      {row.latest ? (
                        <StatusTag status="PUBLISHED" />
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
                          </span>{" "}
                          · {row.latest.row_count ?? 0} rows
                        </span>
                        {row.stagedCount > 0 ? (
                          <Link
                            className="text-[var(--color-status-warning-text)] hover:underline"
                            href="/snapshots?status=STAGED"
                          >
                            {row.stagedCount} staged awaiting publish →
                          </Link>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                        No published snapshots yet for this source.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </PageFrame>
  );
}

function WorkQueueCard({
  count,
  detail,
  href,
  label,
  status,
}: {
  count: number;
  detail: string;
  href: string;
  label: string;
  status: string;
}) {
  return (
    <Link
      className="group flex min-h-[112px] flex-col justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition-colors hover:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)]"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Next action
          </div>
          <div className="mt-1 text-sm font-semibold text-[var(--color-text)]">
            {label}
          </div>
        </div>
        <StatusTag status={status} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold tabular-nums text-[var(--color-text)]">
            {count}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            {detail}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-subtle)] transition-colors group-hover:text-[var(--color-accent)]" />
      </div>
    </Link>
  );
}

/* ─── KPI card with icon, tone, and optional link ─────────────────── */

function KpiCard({
  icon,
  label,
  value,
  meta,
  tone = "neutral",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta?: string;
  tone?: "neutral" | "warning" | "danger";
  href?: string;
}) {
  const valueColor =
    tone === "danger"
      ? "text-[var(--color-status-danger-text)]"
      : tone === "warning"
        ? "text-[var(--color-status-warning-text)]"
        : "text-[var(--color-text)]";
  const iconBg =
    tone === "danger"
      ? "bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]"
      : tone === "warning"
        ? "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]"
        : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]";

  const inner = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div
          aria-hidden="true"
          className={`grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] ${iconBg}`}
        >
          {icon}
        </div>
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-semibold tabular-nums ${valueColor}`}>
        {value}
      </p>
      {meta ? (
        <p className="text-xs text-[var(--color-text-muted)]">{meta}</p>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link
        className="block rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-accent)]"
        href={href}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      {inner}
    </div>
  );
}

/* ─── Entity switcher (CFO/Admin/Reviewer only) ─────────────────── */

function EntitySwitcher({ current }: { current: DashboardEntity }) {
  const opts: DashboardEntity[] = ["ALL", "IND", "UAE"];
  return (
    <div className="flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
      {opts.map((opt) => (
        <Link
          aria-current={current === opt ? "page" : undefined}
          className={[
            "inline-flex h-8 items-center rounded-[var(--radius-sm)] px-3 text-xs font-medium transition-colors",
            current === opt
              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
          href={opt === "ALL" ? "/dashboard" : `/dashboard?entity=${opt}`}
          key={opt}
        >
          {opt}
        </Link>
      ))}
    </div>
  );
}

/* ─── Empty state (no published snapshot) ─────────────────────────── */

async function DashboardEmptyState({
  entity,
  error,
  showSwitcher = false,
}: {
  entity: DashboardEntity;
  error: DashboardError | null;
  showSwitcher?: boolean;
}) {
  // Surface any pending staged snapshots so the user knows publish is the
  // next action — much more useful than a generic "upload something" CTA.
  let pendingStaged: number = 0;
  if (entity !== "ALL") {
    pendingStaged = await getPrisma().snapshots.count({
      where: {
        entities: { is: { code: entity } },
        status: "STAGED",
      },
    });
  } else {
    pendingStaged = await getPrisma().snapshots.count({
      where: { status: "STAGED" },
    });
  }

  return (
    <PageFrame>
      <PageHeader
        actions={showSwitcher ? <EntitySwitcher current={entity} /> : null}
        title="Today's Receivables Priorities"
      >
        {entity === "ALL"
          ? "Consolidated receivables across every entity."
          : `Receivables for ${entity}.`}
      </PageHeader>
      <EmptyState
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-strong)]"
              href="/upload"
            >
              <Upload className="h-4 w-4" />
              Upload a workbook
            </Link>
            {pendingStaged > 0 ? (
              <Link
                className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] px-3 text-sm font-medium text-[var(--color-status-warning-text)] transition-colors hover:opacity-80"
                href="/snapshots?status=STAGED"
              >
                <Layers className="h-4 w-4" />
                {pendingStaged} staged awaiting publish
              </Link>
            ) : null}
          </div>
        }
        description={
          pendingStaged > 0
            ? `There are ${pendingStaged} staged snapshot${pendingStaged === 1 ? "" : "s"} waiting to be published. Once published, KPIs, ageing, and exceptions appear here.`
            : (error?.message ??
              "Upload an AR workbook to populate KPIs, ageing buckets, top parties, and exception alerts on this dashboard.")
        }
        title="No published data yet"
      />
    </PageFrame>
  );
}
