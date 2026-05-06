import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import { HttpError } from "@/server/core/errors";
import {
  getOrComputeReconciliation,
  getSnapshotDetail,
  type ReconciliationResponse,
} from "@/server/snapshots/service";

type PageProps = {
  params: Promise<{ snapshotId: string }>;
};

export default async function SnapshotDetailPage({ params }: PageProps) {
  const { snapshotId } = await params;
  const currentUser = await requirePageRole(
    `/snapshots/${snapshotId}`,
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  let snapshot;
  try {
    snapshot = await getSnapshotDetail(snapshotId, currentUser);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  let reconciliation: ReconciliationResponse | null = null;
  let reconciliationMessage: string | null = null;
  try {
    reconciliation = await getOrComputeReconciliation(snapshotId, currentUser);
  } catch (error) {
    reconciliationMessage =
      error instanceof Error ? error.message : "Reconciliation unavailable";
  }

  const currency = snapshot.entity_code === "IND" ? "INR" : "AED";

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="space-y-2">
          <Link
            href="/snapshots"
            className="text-sm text-blue-700 hover:underline"
          >
            {"<- Snapshots"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Snapshot {snapshot.as_of_date ?? snapshot.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-slate-500">
            {snapshot.entity_code} - {snapshot.source_hint} - {snapshot.status}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>As Of</CardTitle>
            </CardHeader>
            <CardContent>{formatDate(snapshot.as_of_date)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Total Outstanding</CardTitle>
            </CardHeader>
            <CardContent>
              {snapshot.total_outstanding
                ? formatCurrency(snapshot.total_outstanding, currency)
                : "-"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Rows</CardTitle>
            </CardHeader>
            <CardContent>{snapshot.row_count ?? "-"}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Uploaded</dt>
                <dd>{formatDateTime(snapshot.uploaded_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Uploaded By</dt>
                <dd>{snapshot.uploaded_by_email}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Published</dt>
                <dd>{formatDateTime(snapshot.published_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Published By</dt>
                <dd>{snapshot.published_by_email ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Discarded</dt>
                <dd>{formatDateTime(snapshot.discarded_at)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Discarded By</dt>
                <dd>{snapshot.discarded_by_email ?? "-"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reconciliation</CardTitle>
          </CardHeader>
          <CardContent>
            {reconciliation ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Dashboard AR</dt>
                  <dd>
                    {formatCurrency(reconciliation.dashboard_ar, currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Exception Buckets</dt>
                  <dd>
                    {formatCurrency(
                      reconciliation.exception_bucket_total,
                      currency,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd>{reconciliation.status}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Closing AR</dt>
                  <dd>
                    {reconciliation.tally_xero_closing_ar
                      ? formatCurrency(
                          reconciliation.tally_xero_closing_ar,
                          currency,
                        )
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Delta</dt>
                  <dd>
                    {reconciliation.delta
                      ? formatCurrency(reconciliation.delta, currency)
                      : "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Entered By</dt>
                  <dd>{reconciliation.entered_by?.email ?? "-"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">{reconciliationMessage}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
