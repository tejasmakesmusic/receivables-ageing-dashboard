import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import {
  listCreditPeriods,
  listPartiesWithCreditPeriodSummary,
  parseCreditPeriodListQuery,
} from "@/server/config/creditPeriod";
import { listEntityDefaults } from "@/server/config/entityDefaults";
import { EntityDefaultsCard } from "../_components/entity-defaults-card";
import { PartiesCreditPeriodTable } from "./_components/parties-credit-period-table";

export default async function CreditPeriodsWorkspace() {
  const currentUser = await requirePageRole(
    "/config/credit-periods",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );

  const canEdit =
    currentUser.role === role_enum.ANALYST ||
    currentUser.role === role_enum.ADMIN;

  const [entityDefaults, parties, history] = await Promise.all([
    listEntityDefaults(currentUser),
    listPartiesWithCreditPeriodSummary(currentUser),
    listCreditPeriods(
      parseCreditPeriodListQuery({ include_closed: "true", page_size: "25" }),
      currentUser,
    ),
  ]);

  const overrideCount = parties.filter((p) => p.source === "party").length;
  const defaultCount = parties.filter((p) => p.source === "entity_default").length;
  const noneCount = parties.filter((p) => p.source === "none").length;

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="flex flex-col gap-2">
          <nav className="text-xs text-[var(--color-text-muted)]">
            <Link className="hover:underline" href="/config">
              Configuration
            </Link>
            <span className="mx-1">/</span>
            <span>Credit periods</span>
          </nav>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Credit periods workspace</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Set entity-level defaults, override per customer, or apply credit
                terms across many parties in one batch. Every change is versioned
                and audited.
              </p>
            </div>
          </div>
        </header>

        <section
          aria-label="Coverage summary"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <StatCard label="Party overrides" value={overrideCount} />
          <StatCard label="On entity default" value={defaultCount} />
          <StatCard
            emphasize={noneCount > 0}
            label="No credit period"
            value={noneCount}
          />
        </section>

        <section id="entity-defaults" className="scroll-mt-24">
          <EntityDefaultsCard canEdit={canEdit} entities={entityDefaults} />
        </section>

        <section id="parties" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle>Parties</CardTitle>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Filter, multi-select, and apply a credit period to many parties
                at once. Party-level overrides win over entity defaults.
              </p>
            </CardHeader>
            <CardContent>
              <PartiesCreditPeriodTable canEdit={canEdit} parties={parties} />
            </CardContent>
          </Card>
        </section>

        <section id="history" className="scroll-mt-24">
          <Card>
            <CardHeader>
              <CardTitle>Recent history</CardTitle>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Versioned credit-period rows including closed entries. Shows the
                25 most recent.
              </p>
            </CardHeader>
            <CardContent>
              {history.items.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No credit-period rows yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
                    <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                      <tr>
                        <th className="px-3 py-2">Party</th>
                        <th className="px-3 py-2">Entity</th>
                        <th className="px-3 py-2">Days</th>
                        <th className="px-3 py-2">Valid from</th>
                        <th className="px-3 py-2">Valid to</th>
                        <th className="px-3 py-2">Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border)]">
                      {history.items.map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2">
                            <Link
                              className="text-[var(--color-accent)] hover:underline"
                              href={`/party/${row.canonical_id}`}
                            >
                              {row.canonical_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{row.entity_code}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {row.credit_days}
                          </td>
                          <td className="px-3 py-2">{row.valid_from}</td>
                          <td className="px-3 py-2">
                            {row.valid_to ?? (
                              <span className="text-[var(--color-accent)]">
                                Open
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-[var(--color-text-muted)]">
                            {row.reason_note ? (
                              <span className="italic">
                                &ldquo;{row.reason_note}&rdquo;
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  emphasize,
  label,
  value,
}: {
  emphasize?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div
      className={`rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-4 ${
        emphasize
          ? "border-[var(--color-status-warning-text,var(--color-border))]"
          : "border-[var(--color-border)]"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
        {value}
      </p>
    </div>
  );
}
