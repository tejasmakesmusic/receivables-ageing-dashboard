import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { listEmailRules } from "@/server/admin/emailRules";

export const dynamic = "force-dynamic";

export default async function EmailRulesPage() {
  const user = await requirePageRole("/admin/email-rules", role_enum.ADMIN);

  const rules = await listEmailRules(user);

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Email Rules</h1>
            <p className="text-sm text-slate-500">
              Control when and to whom automated emails are sent.
            </p>
          </div>
          <Link
            href="/admin/digest"
            className="text-sm text-blue-700 hover:underline"
          >
            ← Digest events
          </Link>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          {rules.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-400">
              No email rules configured.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Rule type</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Recipients</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const recipients = Array.isArray(rule.recipients_json)
                    ? (rule.recipients_json as string[])
                    : [];
                  return (
                    <tr
                      key={rule.id}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {rule.rule_type}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            rule.is_active
                              ? "text-green-700 font-medium"
                              : "text-slate-400"
                          }
                        >
                          {rule.is_active ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {rule.cron_schedule ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {recipients.length > 0 ? (
                          <ul className="space-y-0.5">
                            {recipients.map((r) => (
                              <li key={r} className="text-xs text-slate-600">
                                {r}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {rule.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-slate-400">
          To enable/disable a rule or update recipients, use{" "}
          <code className="rounded bg-slate-100 px-1">
            PATCH /api/admin/email-rules/:id
          </code>
          . Per spec, the CFO digest will not send until{" "}
          <strong>DAILY_DIGEST</strong> is_active = true.
        </p>
      </div>
    </main>
  );
}
