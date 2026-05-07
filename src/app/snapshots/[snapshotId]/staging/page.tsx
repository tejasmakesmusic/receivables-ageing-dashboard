import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import { getStagingView, stagingQuerySchema } from "@/server/snapshots/service";
import { StagingPublishPanel } from "./_components/staging-publish-panel";
import { StagingRowActions } from "./_components/staging-row-actions";

type PageProps = {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SnapshotStagingPage({
  params,
  searchParams,
}: PageProps) {
  const { snapshotId } = await params;
  const currentUser = await requirePageRole(
    `/snapshots/${snapshotId}/staging`,
    role_enum.ANALYST,
    role_enum.ADMIN,
  );
  const raw = await searchParams;
  const query = stagingQuerySchema.parse({
    offset: first(raw.offset),
    limit: first(raw.limit),
    filter: first(raw.filter),
  });
  const staging = await getStagingView(snapshotId, query, currentUser);
  const currency = staging.entity_code === "IND" ? "INR" : "AED";

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-7xl space-y-4">
        <div className="space-y-2">
          <Link
            href={`/snapshots/${snapshotId}`}
            className="text-sm text-blue-700 hover:underline"
          >
            {"<- Snapshot"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Staging Review
          </h1>
          <p className="text-sm text-slate-500">
            {staging.entity_code} - {staging.source_hint} -{" "}
            {formatDate(staging.as_of_date)}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Rows</CardTitle>
            </CardHeader>
            <CardContent>
              {staging.totals.invoices_total ||
                staging.totals.credit_periods_total}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Unmapped</CardTitle>
            </CardHeader>
            <CardContent>
              {staging.publish_gate.unmapped_parties_count}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Parse Errors</CardTitle>
            </CardHeader>
            <CardContent>
              {staging.publish_gate.parse_errors_unresolved_count}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gate</CardTitle>
            </CardHeader>
            <CardContent>
              {staging.publish_gate.ok ? "Ready" : "Blocked"}
            </CardContent>
          </Card>
        </div>

        <StagingPublishPanel
          publishGate={staging.publish_gate}
          snapshotId={snapshotId}
          sourceHint={staging.source_hint}
        />

        <Card>
          <CardHeader>
            <CardTitle>Rows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Party / Name</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Resolution</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {staging.rows.map((row) => {
                    const isInvoice = "party_name_raw" in row;
                    return (
                      <tr key={row.row_index}>
                        <td className="px-3 py-2">{row.row_index}</td>
                        <td className="px-3 py-2">
                          {isInvoice ? row.party_name_raw : row.name}
                        </td>
                        <td className="px-3 py-2">
                          {isInvoice ? (row.invoice_ref ?? "-") : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {isInvoice ? formatDate(row.invoice_date) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isInvoice && row.amount
                            ? formatCurrency(row.amount, currency)
                            : "-"}
                        </td>
                        <td className="px-3 py-2">
                          {isInvoice
                            ? (row.analyst_overrides.resolved_canonical_id ??
                              row.alias_resolution.resolutionState)
                            : (row.analyst_overrides.resolved_canonical_id ??
                              "-")}
                        </td>
                        <td className="px-3 py-2">
                          {isInvoice ? row.status : "OK"}
                        </td>
                        <td className="px-3 py-2">
                          <StagingRowActions
                            row={row}
                            snapshotId={snapshotId}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
