import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { getInteractiveRowClass } from "@/components/ui/table-row-styles";
import { requirePageRole } from "@/server/core/page-auth";
import { listEmailRules } from "@/server/admin/emailRules";
import { RuleToggle } from "@/app/admin/email-rules/_components/rule-toggle";

export const dynamic = "force-dynamic";

export default async function EmailRulesPage() {
  const user = await requirePageRole("/admin/email-rules", role_enum.ADMIN);

  const rules = await listEmailRules(user);

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Email Rules</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Control when and to whom automated emails are sent.
          </p>
          </div>
          <Link
            href="/admin/digest"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            ← Digest events
          </Link>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
          {rules.length === 0 ? (
            <p className="px-4 py-8 text-center text-[var(--color-text-subtle)]">
              No email rules configured.
            </p>
          ) : (
              <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg-subtle)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-4 py-3">Rule type</th>
                  <th className="px-4 py-3">Active</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Recipients</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rules.map((rule) => {
                  const recipients = Array.isArray(rule.recipients_json)
                    ? (rule.recipients_json as string[])
                    : [];
                  return (
                    <tr
                      className={getInteractiveRowClass()}
                      key={rule.id}
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {rule.rule_type}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            rule.is_active
                              ? "text-[var(--color-success)] font-medium"
                              : "text-[var(--color-text-subtle)]"
                          }
                        >
                          {rule.is_active ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                        {rule.cron_schedule ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {recipients.length > 0 ? (
                          <ul className="space-y-0.5">
                            {recipients.map((r) => (
                            <li key={r} className="text-xs text-[var(--color-text-muted)]">
                                {r}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-[var(--color-text-subtle)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {rule.notes ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RuleToggle
                          isActive={rule.is_active}
                          ruleId={rule.id}
                          ruleType={rule.rule_type}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-[var(--color-text-subtle)]">
          Use the row Activate / Deactivate button to gate email delivery.
          Recipients and cron schedule are still edited via{" "}
          <code className="rounded bg-[var(--color-bg-subtle)] px-1">
            PATCH /api/admin/email-rules/:id
          </code>
          . Per spec, the CFO digest will not send until{" "}
          <strong>DAILY_DIGEST</strong> is_active = true.
        </p>
      </div>
    </div>
  );
}
