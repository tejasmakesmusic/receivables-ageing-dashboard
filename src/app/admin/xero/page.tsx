import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  EmptyState,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { StatusTag } from "@/components/ui/status-tag";
import { role_enum } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { requirePageRole } from "@/server/core/page-auth";
import { ConnectXeroButton } from "./_components/connect-xero-button";
import { DisconnectXeroButton } from "./_components/disconnect-xero-button";

export const dynamic = "force-dynamic";

export default async function XeroAdminPage() {
  await requirePageRole("/admin/xero", role_enum.ADMIN);

  const connections = await getPrisma().xero_connections.findMany({
    where: { entities: { code: "UAE" } },
    orderBy: { updated_at: "desc" },
    take: 10,
  });

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
        title="Xero connection"
      >
        Read-only UAE source connection for staged receivables snapshots.
      </PageHeader>

      <Panel>
        <PanelHeader title="Connection">
          Connect Xero with read-only OAuth scopes. Receivables OS still owns
          ageing, credit days, staging, publish, and audit.
        </PanelHeader>
        <div className="flex justify-end border-b border-[var(--color-border)] p-4">
          <ConnectXeroButton />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {connections.map((connection) => (
              <tr key={connection.id}>
                <td className="px-4 py-3 font-medium">
                  {connection.tenant_name}
                </td>
                <td className="px-4 py-3">
                  <StatusTag
                    label={connection.status}
                    status={
                      connection.status === "ACTIVE"
                        ? "GATE_OK"
                        : "READ_ONLY"
                    }
                  />
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  {formatDateTime(connection.updated_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  {connection.status === "ACTIVE" ? (
                    <DisconnectXeroButton connectionId={connection.id} />
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {connections.length === 0 ? (
              <tr>
                <td className="px-4 py-8" colSpan={4}>
                  <EmptyState
                    description="Connect Xero before analysts can pull UAE snapshots directly."
                    title="No Xero connection configured"
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageFrame>
  );
}
