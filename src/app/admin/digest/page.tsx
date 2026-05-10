import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { role_enum } from "@/generated/prisma/enums";
import { getInteractiveRowClass } from "@/components/ui/table-row-styles";
import { requirePageRole } from "@/server/core/page-auth";
import { listDigestEvents } from "@/server/digest/service";
import {
  DigestActions,
  TriggerDigestButton,
} from "./_components/digest-action-buttons";

export const dynamic = "force-dynamic";

const STATE_VARIANT: Record<
  string,
  "default" | "accent" | "warning" | "success" | "danger"
> = {
  DRAFT: "default",
  PREVIEWED: "warning",
  APPROVED: "accent",
  SENT: "success",
  SKIPPED: "default",
  FAILED: "danger",
};

export default async function AdminDigestPage() {
  await requirePageRole("/admin/digest", role_enum.ADMIN);

  const { items: events, total } = await listDigestEvents({ page_size: 30 });

  return (
    <main className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Digest Events</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{total} total</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin/email-rules"
              className="rounded-md border border-[var(--color-border-medium)] bg-[var(--color-bg)] px-3 py-1.5 text-sm hover:bg-[var(--color-bg-subtle)]"
            >
              Email rules
            </Link>
            <TriggerDigestButton />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-bg-subtle)] text-left text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Snapshots</th>
                <th className="px-4 py-3">Sent at</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {events.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-[var(--color-text-subtle)]"
                  >
                    No digest events yet. Use the trigger button to create one.
                  </td>
                </tr>
              ) : (
                events.map((event) => {
                  const snapshotIds = Array.isArray(event.snapshot_ids)
                    ? event.snapshot_ids
                    : [];
                  return (
                    <tr
                      className={getInteractiveRowClass()}
                      key={event.id}
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {new Date(event.digest_date).toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={STATE_VARIANT[event.state] ?? "default"}
                        >
                          {event.state}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {snapshotIds.length}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {event.sent_at
                          ? new Date(event.sent_at).toLocaleString()
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        <DigestActions id={event.id} state={event.state} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
