import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Database,
  FileCheck2,
  FileText,
  Flag,
  Handshake,
  Inbox,
  ListChecks,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { assertNotPending } from "@/server/core/assertNotPending";
import { requirePageRole } from "@/server/core/page-auth";

export const dynamic = "force-dynamic";

const dailyFlow = [
  {
    href: "/upload",
    icon: Database,
    label: "Import & Sync Data",
    meta: "Upload and parse AR workbooks",
    status: "STAGED",
  },
  {
    href: "/dashboard",
    icon: ListChecks,
    label: "Refresh Ageing & KPIs",
    meta: "Publish snapshots before reporting",
    status: "PUBLISHED",
  },
  {
    href: "/",
    icon: Inbox,
    label: "Review Focus Queue",
    meta: "Prioritized parties and invoices",
    status: "FOLLOW_UP_DUE",
  },
  {
    href: "/tasks",
    icon: Send,
    label: "Take Action",
    meta: "Move collection tasks through the queue",
    status: "TASK_IN_PROGRESS",
  },
  {
    href: "/promises-to-pay",
    icon: Handshake,
    label: "Capture Promise",
    meta: "Track customer commitments",
    status: "PTP_OPEN",
  },
  {
    href: "/tasks",
    icon: Flag,
    label: "Escalate If Needed",
    meta: "Review high-risk work",
    status: "90_PLUS",
  },
] as const;

const lifecycle = [
  {
    href: "/parties",
    icon: ShieldCheck,
    label: "Identify & Prioritize",
    meta: "Score by ageing and exceptions",
    status: "READ_ONLY",
  },
  {
    href: "/tasks",
    icon: Bell,
    label: "Engage",
    meta: "Phone, email, and follow-up tasks",
    status: "TASK_OPEN",
  },
  {
    href: "/promises-to-pay",
    icon: Handshake,
    label: "Negotiate",
    meta: "Promises and payment plans",
    status: "PTP_OPEN",
  },
  {
    href: "/tasks?tab=calendar",
    icon: CheckCircle2,
    label: "Monitor & Follow Up",
    meta: "Due dates and scheduled work",
    status: "TASK_SNOOZED",
  },
  {
    href: "/reconciliation",
    icon: FileCheck2,
    label: "Resolve & Cure",
    meta: "Tie-out and close the loop",
    status: "RECONCILIATION_PENDING",
  },
] as const;

const closeFlow = [
  {
    href: "/reconciliation",
    icon: RefreshCw,
    label: "Reconcile Snapshots",
    meta: "Dashboard AR to closing AR",
    status: "RECONCILIATION_PENDING",
  },
  {
    href: "/dispute-cases",
    icon: Flag,
    label: "Resolve Exceptions",
    meta: "Disputes and exception tags",
    status: "DISPUTE_OPEN",
  },
  {
    href: "/reports",
    icon: FileText,
    label: "Update Reports",
    meta: "Executive dashboards and exports",
    status: "PUBLISHED",
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    label: "Close Cycle",
    meta: "Admin controls and audit history",
    status: "READ_ONLY",
  },
] as const;

function WorkflowStep({
  href,
  icon: Icon,
  label,
  meta,
  status,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  meta: string;
  status: string;
}) {
  return (
    <Link
      className="min-h-40 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-accent)]"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Icon className="h-5 w-5" />
        </div>
        <StatusTag status={status} />
      </div>
      <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">
        {label}
      </div>
      <div className="mt-2 min-h-10 text-xs text-[var(--color-text-muted)]">
        {meta}
      </div>
      <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
        Open
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function WorkflowBand({
  items,
  number,
  subtitle,
  title,
}: {
  items: readonly {
    href: string;
    icon: ComponentType<{ className?: string }>;
    label: string;
    meta: string;
    status: string;
  }[];
  number: number;
  subtitle: string;
  title: string;
}) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] text-sm font-semibold text-white">
            {number}
          </span>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              {title}
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">{subtitle}</p>
          </div>
        </div>
        <StatusTag status="WORKFLOW_DRAFT" />
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {items.map((item) => (
          <WorkflowStep key={item.label} {...item} />
        ))}
      </div>
    </Panel>
  );
}

export default async function WorkflowsPage() {
  const user = await requirePageRole(
    "/workflows",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  assertNotPending(user);

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/tasks"
            >
              <Inbox className="h-4 w-4" />
              Collection Queue
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/reconciliation"
            >
              <RefreshCw className="h-4 w-4" />
              Reconciliation
            </Link>
          </>
        }
        title="Core Workflows"
      >
        End-to-end receivables paths across ageing, tasks, and close.
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <WorkflowBand
            items={dailyFlow}
            number={1}
            subtitle="Drive daily execution and move parties forward."
            title="Daily Analyst Flow"
          />
          <WorkflowBand
            items={lifecycle}
            number={2}
            subtitle="Manage parties through structured stages to resolution."
            title="Task Lifecycle"
          />
          <WorkflowBand
            items={closeFlow}
            number={3}
            subtitle="Reconcile activity, ensure accuracy, and close the cycle."
            title="Reconciliation & Close"
          />
        </div>

        <RightRail>
          <Panel>
            <PanelHeader title="Platform Functions">
              Connected surfaces.
            </PanelHeader>
            <div className="divide-y divide-[var(--color-border)]">
              {[
                ["Parties", "/parties"],
                ["Invoices", "/invoices"],
                ["Tasks", "/tasks"],
                ["Reconciliation", "/reconciliation"],
                ["Reports", "/reports"],
                ["Admin", "/admin"],
              ].map(([label, href]) => (
                <Link
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]"
                  href={href}
                  key={href}
                >
                  {label}
                  <ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" />
                </Link>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="At A Glance">
              Current workflow posture.
            </PanelHeader>
            <div className="space-y-3 p-4 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Mapped surfaces</span>
                <span className="font-semibold">6</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-text-muted)]">Role</span>
                <StatusTag label={user.role} status="READ_ONLY" />
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-3 text-[var(--color-text-muted)]">
                These maps link directly to live product surfaces and show the
                current process posture from published receivables data.
              </div>
            </div>
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
