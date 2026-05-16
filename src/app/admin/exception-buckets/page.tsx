import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { listExceptionBuckets } from "@/server/admin/exceptionBuckets";
import { requirePageRole } from "@/server/core/page-auth";
import { ExceptionBucketsManager } from "./_components/exception-buckets-manager";

export const dynamic = "force-dynamic";

export default async function ExceptionBucketsPage() {
  const currentUser = await requirePageRole(
    "/admin/exception-buckets",
    role_enum.ADMIN,
  );
  const buckets = await listExceptionBuckets(currentUser);

  return (
    <PageFrame>
      <PageHeader
        actions={
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
            href="/admin"
          >
            ← Admin
          </Link>
        }
        title="Exception Buckets"
      >
        Manage the catalog of exception-tag bucket types used by the
        reconciliation and exceptions workflow.
      </PageHeader>

      <Panel>
        <PanelHeader title="Bucket types">
          Codes are uppercase, stable identifiers. Deactivating hides the
          bucket from new exception tagging but preserves historical rows.
        </PanelHeader>
        <div className="p-4">
          <ExceptionBucketsManager buckets={buckets.items} />
        </div>
      </Panel>
    </PageFrame>
  );
}
