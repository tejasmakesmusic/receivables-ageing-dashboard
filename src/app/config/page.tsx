import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { getInteractiveRowClass } from "@/components/ui/table-row-styles";
import { requirePageRole } from "@/server/core/page-auth";
import {
  listCreditPeriods,
  parseCreditPeriodListQuery,
} from "@/server/config/creditPeriod";
import { listAliases, parseAliasListQuery } from "@/server/config/aliases";
import { listFxRates, parseFxRateListQuery } from "@/server/config/fxRates";
import { listEntityDefaults } from "@/server/config/entityDefaults";
import { EntityDefaultsCard } from "./_components/entity-defaults-card";

export default async function ConfigPage() {
  const currentUser = await requirePageRole(
    "/config",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );

  const creditPeriods = await listCreditPeriods(
    parseCreditPeriodListQuery({}),
    currentUser,
  );
  const aliases = await listAliases(parseAliasListQuery({}), currentUser);
  const fxRates = await listFxRates(parseFxRateListQuery({}), currentUser);
  const entityDefaults = await listEntityDefaults(currentUser);

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <h1 className="text-2xl font-semibold">Configuration</h1>

        <Card>
          <CardHeader>
            <CardTitle>Credit Periods</CardTitle>
          </CardHeader>
          <CardContent>
            {creditPeriods.items.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                No credit-period rows.
              </p>
            ) : (
              <table className="w-full table-auto text-sm">
                <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Canonical</th>
                    <th className="px-3 py-2">Entity</th>
                    <th className="px-3 py-2">Days</th>
                    <th className="px-3 py-2">Valid From</th>
                    <th className="px-3 py-2">Valid To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {creditPeriods.items.slice(0, 5).map((row) => (
                    <tr className={getInteractiveRowClass()} key={row.id}>
                      <td className="px-3 py-2">{row.canonical_name}</td>
                      <td className="px-3 py-2">{row.entity_code}</td>
                      <td className="px-3 py-2">{row.credit_days}</td>
                      <td className="px-3 py-2">{row.valid_from}</td>
                      <td className="px-3 py-2">{row.valid_to ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aliases</CardTitle>
          </CardHeader>
          <CardContent>
            {aliases.items.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No aliases.</p>
            ) : (
              <table className="w-full table-auto text-sm">
                <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Canonical</th>
                    <th className="px-3 py-2">Alias</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Entity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {aliases.items.slice(0, 5).map((row) => (
                    <tr className={getInteractiveRowClass()} key={row.id}>
                      <td className="px-3 py-2">
                        <Link
                          className="text-[var(--color-accent)] hover:underline"
                          href={`/party/${row.canonical_id}`}
                        >
                          {row.canonical_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{row.alias_text}</td>
                      <td className="px-3 py-2">{row.source}</td>
                      <td className="px-3 py-2">{row.entity_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>FX Rates</CardTitle>
          </CardHeader>
          <CardContent>
            {fxRates.items.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No FX rates.</p>
            ) : (
              <table className="w-full table-auto text-sm">
                <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Pair</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2">Effective</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {fxRates.items.slice(0, 5).map((row) => (
                    <tr className={getInteractiveRowClass()} key={row.id}>
                      <td className="px-3 py-2">
                        {row.from_ccy}/{row.to_ccy}
                      </td>
                      <td className="px-3 py-2">{row.rate}</td>
                      <td className="px-3 py-2">{row.valid_from}</td>
                      <td className="px-3 py-2">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <EntityDefaultsCard
          canEdit={
            currentUser.role === role_enum.ANALYST ||
            currentUser.role === role_enum.ADMIN
          }
          entities={entityDefaults}
        />
      </div>
    </div>
  );
}
