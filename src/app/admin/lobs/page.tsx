import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import {
  EmptyState,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import { listLobs } from "@/server/lobs/service";
import {
  CreateLobForm,
  ToggleLobActiveButton,
} from "./_components/lob-actions";

export const dynamic = "force-dynamic";

/**
 * PR 9 — admin LOBs management.
 * ADMIN-only mutations, but ANALYST/CFO/REVIEWER can read so they understand
 * what tags exist when filtering on /invoices?lob=…
 */
export default async function AdminLobsPage() {
  const currentUser = await requirePageRole(
    "/admin/lobs",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  const isAdmin = currentUser.role === role_enum.ADMIN;
  const items = await listLobs({}, currentUser);

  return (
    <PageFrame>
      <PageHeader
        eyebrow={
          <Link
            className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            href="/admin"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Admin
          </Link>
        }
        title="Lines of Business"
      >
        Tags applied to invoices so receivables can be sliced by project,
        vertical, or business unit. Auto-applied from Xero{" "}
        <code className="rounded bg-[var(--color-bg-muted)] px-1">
          PROJECT ID
        </code>{" "}
        on publish.
      </PageHeader>

      {isAdmin ? (
        <Panel>
          <PanelHeader title="Create new LOB">
            Codes are scoped per entity and used for case-insensitive matching
            against the invoice&apos;s source <code>project_id</code>.
          </PanelHeader>
          <div className="p-4">
            <CreateLobForm />
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="All LOBs">
          {items.length === 0 ? "No LOBs yet." : `${items.length} configured`}
        </PanelHeader>
        {items.length === 0 ? (
          <div className="p-8">
            <EmptyState
              description={
                isAdmin
                  ? "Create your first LOB above. Once added, future Xero uploads with a matching PROJECT ID will be auto-tagged."
                  : "An admin needs to create LOBs before invoices can be tagged."
              }
              title="No LOBs configured"
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Tagged Invoices</th>
                <th className="px-4 py-3">Updated</th>
                {isAdmin ? <th className="px-4 py-3 text-right" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {items.map((lob) => (
                <tr key={lob.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    {lob.entity_code}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{lob.code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{lob.name}</div>
                    {lob.description ? (
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {lob.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusTag
                      label={lob.active ? "Active" : "Inactive"}
                      status={lob.active ? "GATE_OK" : "READ_ONLY"}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {lob.invoice_count}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                    {formatDateTime(lob.updated_at)}
                  </td>
                  {isAdmin ? (
                    <td className="px-4 py-3 text-right">
                      <ToggleLobActiveButton
                        active={lob.active}
                        lobId={lob.id}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </PageFrame>
  );
}
