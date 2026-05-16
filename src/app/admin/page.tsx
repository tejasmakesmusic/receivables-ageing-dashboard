import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowRight,
  ClipboardList,
  Mail,
  Scale,
  ShieldCheck,
} from "lucide-react";
import DataResetForm from "@/app/admin/_components/data-reset-form";
import { UserRowActions } from "@/app/admin/_components/user-row-actions";
import { EmptyTableRow, TableShell } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
  SavedViewLink,
  SavedViewTabs,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { getImportedDataResetPreview } from "@/server/admin/dataReset";
import { listUsers, parseUserListQuery } from "@/server/admin/users";
import { listEmailRules } from "@/server/admin/emailRules";
import { requirePageRole } from "@/server/core/page-auth";

export const dynamic = "force-dynamic";

const adminLinks = [
  ["Users & Roles", "/admin"],
  ["Lines of Business", "/admin/lobs"],
  ["FX Rates", "/admin/fx-rates"],
  ["Exception Buckets", "/admin/exception-buckets"],
  ["Party Aliases", "/config/aliases"],
  ["Digest Events", "/admin/digest"],
  ["Email Rules", "/admin/email-rules"],
  ["Reconciliation", "/admin/reconciliation"],
  ["Audit Log", "/admin/audit-log"],
] as const;

type AdminQueue = {
  description: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  status: string;
};

function buildAdminQueues({
  pendingUsers,
  activeRules,
  totalRules,
}: {
  pendingUsers: number;
  activeRules: number;
  totalRules: number;
}): AdminQueue[] {
  return [
    {
      description: "Generated daily digest records and approval state.",
      href: "/admin/digest",
      icon: Mail,
      label: "Digest Events",
      status: "PUBLISHED",
    },
    {
      description:
        totalRules === 0
          ? "No rules configured — outbound emails will not be sent."
          : `Email policy gates: ${activeRules}/${totalRules} active.`,
      href: "/admin/email-rules",
      icon: ShieldCheck,
      label: "Email Rules",
      status:
        totalRules === 0
          ? "NO_DATA"
          : activeRules === 0
            ? "STAGING_BLOCKED"
            : "GATE_OK",
    },
    {
      description: "Snapshot closing AR tie-out and mismatch review.",
      href: "/admin/reconciliation",
      icon: Scale,
      label: "Reconciliation",
      status: "READ_ONLY",
    },
    {
      description:
        pendingUsers > 0
          ? `${pendingUsers} pending user${pendingUsers === 1 ? "" : "s"} awaiting approval.`
          : "Mutation trail for users, snapshots, and operational actions.",
      href: pendingUsers > 0 ? "/admin" : "/admin/audit-log",
      icon: ClipboardList,
      label: pendingUsers > 0 ? "Pending users" : "Audit Log",
      status: pendingUsers > 0 ? "FOLLOW_UP_DUE" : "PUBLISHED",
    },
  ];
}

function roleStatus(role: string) {
  if (role === "PENDING") return "STAGING_BLOCKED";
  if (role === "ADMIN") return "WORKFLOW_DRAFT";
  if (role === "CFO") return "READ_ONLY";
  return "TASK_IN_PROGRESS";
}

export default async function AdminPage() {
  const currentUser = await requirePageRole("/admin", role_enum.ADMIN);
  const [users, emailRules, resetPreview] = await Promise.all([
    listUsers(parseUserListQuery({})),
    listEmailRules(currentUser),
    getImportedDataResetPreview(currentUser),
  ]);
  const activeUsers = users.items.filter((user) => user.is_active).length;
  const pendingUsers = users.items.filter((user) => user.role === "PENDING").length;
  const activeRules = emailRules.filter((r) => r.is_active).length;
  const adminQueues = buildAdminQueues({
    pendingUsers,
    activeRules,
    totalRules: emailRules.length,
  });

  return (
    <PageFrame>
      <PageHeader
        actions={
          <>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/admin/email-rules"
            >
              <Mail className="h-4 w-4" />
              Email Rules
            </Link>
            <Link
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
              href="/admin/audit-log"
            >
              <ClipboardList className="h-4 w-4" />
              Audit Log
            </Link>
          </>
        }
        title="Admin & Configuration"
      >
        Manage access, policy gates, reconciliation controls, and auditability.
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <SavedViewTabs>
            {adminLinks.map(([label, href]) => (
              <SavedViewLink active={href === "/admin"} href={href} key={href}>
                {label}
              </SavedViewLink>
            ))}
          </SavedViewTabs>

          <Panel>
            <PanelHeader
              action={<StatusTag label={`${users.total} users`} status="READ_ONLY" />}
              title="Users & Roles"
            >
              Access roster from authenticated users and approval state.
            </PanelHeader>
            <TableShell>
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Entity Scope</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Login</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {users.items.length === 0 ? (
                    <EmptyTableRow colSpan={6}>
                      <EmptyState
                        description="Users appear after sign-in and approval."
                        title="No users found"
                      />
                    </EmptyTableRow>
                  ) : (
                    users.items.map((user) => (
                      <tr
                        className="transition-colors hover:bg-[var(--color-bg-subtle)]"
                        key={user.id}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-[var(--color-text)]">
                            {user.name || user.email}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {user.email}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag label={user.role} status={roleStatus(user.role)} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                          {user.entity_id_scope
                            ? user.entity_id_scope.slice(0, 8)
                            : "All entities"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusTag
                            label={user.is_active ? "Active" : "Inactive"}
                            status={user.is_active ? "MATCHED" : "NO_DATA"}
                          />
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)]">
                          {user.last_login_at ? formatDateTime(user.last_login_at) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <UserRowActions
                            isActive={user.is_active}
                            role={user.role}
                            userId={user.id}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableShell>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Admin Work Queues">
                Operational controls backed by active admin routes.
              </PanelHeader>
              <div className="divide-y divide-[var(--color-border)]">
                {adminQueues.map(({ description, href, icon: Icon, label, status }) => (
                  <Link
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-[var(--color-bg-subtle)]"
                    href={href}
                    key={href}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-[var(--color-text)]">
                          {label}
                        </span>
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">
                          {description}
                        </span>
                      </span>
                    </span>
                    <StatusTag status={status} />
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Governance">
                RBAC-sensitive configuration and audit surfaces.
              </PanelHeader>
              <div className="space-y-3 p-4">
                {[
                  ["User approvals", "/admin", `${pendingUsers} pending`],
                  [
                    "Email policy",
                    "/admin/email-rules",
                    emailRules.length === 0
                      ? "Not configured"
                      : `${activeRules}/${emailRules.length} active`,
                  ],
                  ["Reconciliation review", "/admin/reconciliation", "Snapshot tie-out"],
                  ["Audit trail", "/admin/audit-log", "Mutation history"],
                ].map(([label, href, detail]) => (
                  <Link
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm hover:border-[var(--color-accent)]"
                    href={href}
                    key={href}
                  >
                    <span>
                      <span className="block font-medium text-[var(--color-text)]">
                        {label}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {detail}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-[var(--color-text-muted)]" />
                  </Link>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <RightRail>
          <Panel>
            <PanelHeader title="Admin Summary">
              Current access and control posture.
            </PanelHeader>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-text-muted)]">Active users</div>
                  <div className="mt-1 text-xl font-semibold">{activeUsers}</div>
                </div>
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-text-muted)]">Pending</div>
                  <div className="mt-1 text-xl font-semibold">{pendingUsers}</div>
                </div>
              </div>

              <div className="rounded-[var(--radius-md)] bg-[var(--color-bg-subtle)] p-3 text-sm text-[var(--color-text-muted)]">
                CFO and pending users remain read-limited by route handlers;
                admin mutations continue to write audit log entries.
              </div>

              <div className="space-y-2">
                {adminQueues.slice(0, 3).map(({ href, label }) => (
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
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              action={<StatusTag label="Admin only" status="STAGING_BLOCKED" />}
              title="Data Reset"
            >
              Remove imported receivables data while preserving configuration.
            </PanelHeader>
            <DataResetForm
              confirmationPhrase={resetPreview.confirmation_phrase}
              counts={resetPreview.counts}
            />
          </Panel>
        </RightRail>
      </div>
    </PageFrame>
  );
}
