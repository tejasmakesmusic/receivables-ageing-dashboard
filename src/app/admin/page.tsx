import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { listUsers, parseUserListQuery } from "@/server/admin/users";

export default async function AdminPage() {
  await requirePageRole("/admin", role_enum.ADMIN);

  const users = await listUsers(parseUserListQuery({}));

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Admin</h1>
          <div className="flex gap-4">
            <Link
              className="text-sm text-blue-700 hover:underline"
              href="/admin/digest"
            >
              Digest events
            </Link>
            <Link
              className="text-sm text-blue-700 hover:underline"
              href="/admin/email-rules"
            >
              Email rules
            </Link>
            <Link
              className="text-sm text-blue-700 hover:underline"
              href="/admin/reconciliation"
            >
              Reconciliation
            </Link>
            <Link
              className="text-sm text-blue-700 hover:underline"
              href="/admin/audit-log"
            >
              Audit log
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            {users.items.length === 0 ? (
              <p className="text-sm text-slate-500">No users found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Role</th>
                      <th className="px-3 py-2">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.items.map((user) => (
                      <tr key={user.id} className="odd:bg-white">
                        <td className="px-3 py-2">{user.email}</td>
                        <td className="px-3 py-2">{user.name}</td>
                        <td className="px-3 py-2">{user.role}</td>
                        <td className="px-3 py-2">
                          {user.is_active ? "Yes" : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
