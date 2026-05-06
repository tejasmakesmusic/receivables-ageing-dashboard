import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { listDigestEvents } from "@/server/digest/service";
import { Badge } from "@/components/ui/badge";

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
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Digest Events</h1>
            <p className="text-sm text-slate-500">{total} total</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin/email-rules"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Email rules
            </Link>
            <TriggerDigestButton />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Snapshots</th>
                <th className="px-4 py-3">Sent at</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No digest events yet. Use the trigger button to create one.
                  </td>
                </tr>
              ) : (
                events.map((event) => {
                  const snapshotIds = Array.isArray(event.snapshot_ids)
                    ? event.snapshot_ids
                    : [];
                  return (
                    <tr key={event.id} className="border-t border-slate-100">
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
                      <td className="px-4 py-3 text-slate-500">
                        {snapshotIds.length}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {event.sent_at
                          ? new Date(event.sent_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <DigestActions
                          id={event.id}
                          state={event.state}
                        />
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

// ── Client action components ──────────────────────────────────────────────

function TriggerDigestButton() {
  return (
    <form action="/api/admin/digest/trigger" method="post">
      <button
        type="submit"
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
      >
        Trigger today&apos;s digest
      </button>
    </form>
  );
}

function DigestActions({
  id,
  state,
}: {
  id: string;
  state: string;
}) {
  const canApprove = state === "PREVIEWED";
  const canSkip = !["SENT", "SKIPPED", "FAILED"].includes(state);

  if (!canApprove && !canSkip) {
    return <span className="text-slate-400">—</span>;
  }

  return (
    <div className="flex gap-2">
      {canApprove && (
        <form action={`/api/admin/digest/${id}/approve`} method="post">
          <button
            type="submit"
            className="rounded bg-green-100 px-2 py-1 text-xs text-green-800 hover:bg-green-200"
          >
            Approve & send
          </button>
        </form>
      )}
      {canSkip && (
        <form action={`/api/admin/digest/${id}/skip`} method="post">
          <button
            type="submit"
            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
          >
            Skip
          </button>
        </form>
      )}
    </div>
  );
}
