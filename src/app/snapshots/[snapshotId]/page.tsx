import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ProgressPath,
  type ProgressStep,
} from "@/components/engagement/progress-path";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { requirePageRole } from "@/server/core/page-auth";
import { HttpError } from "@/server/core/errors";
import {
  getOrComputeReconciliation,
  getSnapshotDetail,
  type ReconciliationResponse,
  type SnapshotDetailResponse,
} from "@/server/snapshots/service";

type PageProps = {
  params: Promise<{ snapshotId: string }>;
};

type ParseSummary = {
  totalRows: number;
  okRows: number;
  parseErrorRows: number;
  warningCount: number;
  fileErrorCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeParseResult(value: unknown): ParseSummary {
  if (!isRecord(value)) {
    return {
      totalRows: 0,
      okRows: 0,
      parseErrorRows: 0,
      warningCount: 0,
      fileErrorCount: 0,
    };
  }

  const invoices = Array.isArray(value.invoices) ? value.invoices : [];
  const creditPeriods = Array.isArray(value.credit_periods)
    ? value.credit_periods
    : [];
  const parseErrorRows = invoices.filter(
    (row) => isRecord(row) && row.status === "PARSE_ERROR",
  ).length;
  const okInvoiceRows = invoices.filter(
    (row) => isRecord(row) && row.status !== "PARSE_ERROR",
  ).length;

  return {
    totalRows: invoices.length + creditPeriods.length,
    okRows: okInvoiceRows + creditPeriods.length,
    parseErrorRows,
    warningCount: countArray(value.warnings),
    fileErrorCount: countArray(value.errors),
  };
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function buildProgressSteps(params: {
  snapshot: SnapshotDetailResponse;
  parseSummary: ParseSummary;
  reconciliation: ReconciliationResponse | null;
}): ProgressStep[] {
  const { snapshot, parseSummary, reconciliation } = params;
  const totalErrors = parseSummary.parseErrorRows + parseSummary.fileErrorCount;
  const parseCompleted = parseSummary.okRows > 0;
  const parseBlocked = parseSummary.totalRows > 0 && !parseCompleted;
  const readyToPublish = parseCompleted && totalErrors === 0;
  const isPublished = snapshot.status === "PUBLISHED";
  const hasReconciliation =
    reconciliation !== null && reconciliation.status !== "UNRECONCILED";

  return [
    {
      id: "upload",
      label: "Upload",
      description: "Workbook snapshot is recorded.",
      state: "completed",
      href: "/snapshots",
    },
    {
      id: "parse",
      label: "Parse",
      description: `${parseSummary.okRows} parsed ${pluralize(
        parseSummary.okRows,
        "row",
        "rows",
      )}.`,
      state: parseCompleted ? "completed" : parseBlocked ? "blocked" : "active",
      blocker: parseBlocked ? "All parsed rows are currently errored." : undefined,
      href: `/snapshots/${snapshot.id}/staging`,
    },
    {
      id: "review",
      label: "Review",
      description: `${parseSummary.warningCount} ${pluralize(
        parseSummary.warningCount,
        "warning",
        "warnings",
      )} to review.`,
      state:
        totalErrors > 0
          ? "blocked"
          : parseSummary.warningCount > 0
            ? "active"
            : parseCompleted
              ? "completed"
              : "not_started",
      blocker:
        totalErrors > 0
          ? `${totalErrors} parser ${pluralize(totalErrors, "error", "errors")} remain.`
          : undefined,
      href: `/snapshots/${snapshot.id}/staging`,
    },
    {
      id: "resolve",
      label: "Resolve",
      description: `${totalErrors} parser ${pluralize(totalErrors, "error", "errors")} open.`,
      state:
        totalErrors > 0 ? "active" : parseCompleted ? "completed" : "not_started",
      href: `/snapshots/${snapshot.id}/staging`,
    },
    {
      id: "publish",
      label: "Publish",
      description: isPublished
        ? "Snapshot is published."
        : "Snapshot is waiting for publish.",
      state: isPublished
        ? "completed"
        : readyToPublish
          ? "active"
          : totalErrors > 0
            ? "blocked"
            : "not_started",
      blocker:
        totalErrors > 0
          ? `${totalErrors} parser ${pluralize(totalErrors, "error", "errors")} block publish.`
          : undefined,
      href: `/snapshots/${snapshot.id}/staging`,
    },
    {
      id: "reconcile",
      label: "Reconcile",
      description: hasReconciliation
        ? "Reconciliation entry is recorded."
        : "Reconciliation entry is pending.",
      state: hasReconciliation
        ? "completed"
        : isPublished
          ? "active"
          : "not_started",
      href: isPublished ? "/admin/reconciliation" : undefined,
    },
  ];
}

export default async function SnapshotDetailPage({ params }: PageProps) {
  const { snapshotId } = await params;
  const currentUser = await requirePageRole(
    `/snapshots/${snapshotId}`,
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.ADMIN,
  );
  let snapshot: SnapshotDetailResponse;
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
  const snapshotParse = await getPrisma().snapshots.findUnique({
    where: { id: snapshotId },
    select: { parse_result_json: true },
  });
  const progressSteps = buildProgressSteps({
    snapshot,
    parseSummary: summarizeParseResult(snapshotParse?.parse_result_json),
    reconciliation,
  });

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

        <ProgressPath steps={progressSteps} />

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
