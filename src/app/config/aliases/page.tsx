import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { listAliases } from "@/server/config/aliases";
import { requirePageRole } from "@/server/core/page-auth";
import { AliasesManager } from "./_components/aliases-manager";

export const dynamic = "force-dynamic";

export default async function AliasesPage() {
  const currentUser = await requirePageRole(
    "/config/aliases",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );
  const response = await listAliases(
    { page: 1, page_size: 200 },
    currentUser,
  );
  const canEdit = currentUser.role === role_enum.ADMIN;

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
            href="/config"
          >
            ← Config
          </Link>
        }
        title="Party Aliases"
      >
        Map source-system party names onto canonical parties. Aliases drive
        Tally / Xero ingestion at staging time.
      </PageHeader>

      <Panel>
        <PanelHeader title={`${response.pagination.total} aliases`}>
          {canEdit
            ? "Admins can edit alias text or delete a mapping. Deletions force re-mapping on next import."
            : "Read-only view. Ask an admin to edit or remove mappings."}
        </PanelHeader>
        <div className="p-4">
          <AliasesManager aliases={response.items} canEdit={canEdit} />
        </div>
      </Panel>
    </PageFrame>
  );
}
