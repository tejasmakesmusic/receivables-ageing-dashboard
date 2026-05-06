/**
 * Admin reconciliation view (A6 in spec §9).
 *
 * Lists all PUBLISHED snapshots with their reconciliation status.
 * Analysts enter Tally/Xero closing AR on the snapshot detail page;
 * here admins see the status at a glance.
 */
import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { StatusTag } from "@/components/ui/status-tag";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatMoney(value: string | null | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (isNaN(n)) return value;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default async function AdminReconciliationPage() {
  await requirePageRole("/admin/reconciliation", role_enum.ADMIN);

  const prisma = getPrisma();

  // Fetch recent PUBLISHED snapshots with their reconciliation entry (if any)
  const snapshots = await prisma.snapshots.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { as_of_date: "desc" },
    take: 100,
    include: {
      entities: { select: { code: true, base_currency: true } },
      reconciliation_entries: {
        select: {
          id: true,
          status: true,
          dashboard_ar: true,
          tally_xero_closing_ar: true,
          delta: true,
          entered_at: true,
          notes: true,
          users: { select: { email: true } },
        },
      },
    },
  });

  const total = snapshots.length;
  const mismatched = snapshots.filter(
    (s) => s.reconciliation_entries?.status === "MISMATCHED",
  ).length;
  const unreconciled = snapshots.filter(
    (s) => !s.reconciliation_entries,
  ).length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Reconciliation (A6)</h1>
            <p className="text-sm text-slate-500">
              {total} published snapshot{total !== 1 ? "s" : ""} · {mismatched}{" "}
              mismatched · {unreconciled} unreconciled
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ← Admin
          </Link>
        </div>

        {/* Alert banner for mismatches */}
        {mismatched > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            ⚠️ {mismatched} snapshot{mismatched !== 1 ? "s have" : " has"} a
            reconciliation mismatch. Review below and resolve before the next
            publish.
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">As of date</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Dashboard AR</th>
                <th className="px-4 py-3 text-right">Tally/Xero AR</th>
                <th className="px-4 py-3 text-right">Delta</th>
                <th className="px-4 py-3">Entered by</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-400"
                  >
                    No published snapshots yet.
                  </td>
                </tr>
              ) : (
                snapshots.map((snap) => {
                  const rec = snap.reconciliation_entries;
                  const reconStatus = rec?.status ?? "UNRECONCILED";
                  return (
                    <tr key={snap.id} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-mono text-xs">
                        {snap.as_of_date
                          ? new Date(snap.as_of_date)
                              .toISOString()
                              .slice(0, 10)
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {snap.entities.code} ({snap.entities.base_currency})
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusTag status={reconStatus} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {formatMoney(rec?.dashboard_ar?.toString())}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {rec?.tally_xero_closing_ar
                          ? formatMoney(rec.tally_xero_closing_ar.toString())
                          : "—"}
                      </td>
                      <td
                        className={[
                          "px-4 py-3 text-right font-mono text-xs",
                          rec?.delta && Number(rec.delta) !== 0
                            ? "text-red-600"
                            : "text-slate-600",
                        ].join(" ")}
                      >
                        {rec?.delta ? formatMoney(rec.delta.toString()) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {rec?.users?.email ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/snapshots/${snap.id}`}
                          className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                        >
                          View snapshot
                        </Link>
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
