import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { listAuditLog, parseAuditLogQuery } from "@/server/admin/auditLog";

export default async function AdminAuditLogPage() {
  const currentUser = await requirePageRole("/admin/audit-log", role_enum.ADMIN);
  const logs = await listAuditLog(
    parseAuditLogQuery({ page: "1", page_size: "25" }),
    currentUser,
  );

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <Link className="text-sm text-blue-700 hover:underline" href="/admin">
            Back to admin
          </Link>
        </div>

        <div className="rounded border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full table-auto text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {logs.items.map((row) => (
                  <tr key={row.id} className="odd:bg-white">
                    <td className="px-3 py-2">
                      {row.actor_email ?? row.actor_user_id}
                    </td>
                    <td className="px-3 py-2">{row.action}</td>
                    <td className="px-3 py-2">{row.entity_type}</td>
                    <td className="px-3 py-2">{row.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
