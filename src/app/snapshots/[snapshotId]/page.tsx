import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
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
import {
  summarizeSnapshotProgressParse,
  type SnapshotProgressParseSummary,
} from "@/server/snapshots/progress-summary";
import { SnapshotReviewActions } from "./_components/snapshot-review-actions";

type PageProps = {
  params: Promise<{ snapshotId: string }>;
};

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

function buildProgressSteps(params: {
  snapshot: SnapshotDetailResponse;
  parseSummary: SnapshotProgressParseSummary;
  reconciliation: ReconciliationResponse | null;
}): ProgressStep[] {
  const { snapshot, parseSummary, reconciliation } = params;
  const totalErrors = parseSummary.parseErrorRows + parseSummary.fileErrorCount;
  const parseCompleted = parseSummary.okRows > 0;
  const parseBlocked = parseSummary.totalRows > 0 && !parseCompleted;
  const readyToPublish =
    parseCompleted && totalErrors === 0 && parseSummary.warningCount === 0;
  const isPublished = snapshot.status === "PUBLISHED";
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
      description:
        reconciliation?.status === "MATCHED"
          ? "Auto-reconciled from source file."
          : reconciliation?.status === "MISMATCHED"
            ? "Mismatch detected — check reconciliation."
            : isPublished
              ? "Source file total unavailable."
              : "Pending publish.",
      state:
        reconciliation?.status === "MATCHED"
          ? "completed"
          : reconciliation?.status === "MISMATCHED"
            ? "blocked"
            : isPublished
              ? "active"
              : "not_started",
      href: undefined,
    },
  ];
}

export default async function SnapshotDetailPage({ params }: PageProps) {
  const { snapshotId } = await params;
  const currentUser = await requirePageRole(
    `/snapshots/${snapshotId}`,
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
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
    select: {
      parse_result_json: true,
      staging_overrides_json: true,
      warnings_acknowledged_json: true,
    },
  });
  const progressSteps = buildProgressSteps({
    snapshot,
    parseSummary: summarizeSnapshotProgressParse({
      parseResult: snapshotParse?.parse_result_json,
      stagingOverrides: snapshotParse?.staging_overrides_json,
      warningsAcknowledged: snapshotParse?.warnings_acknowledged_json,
    }),
    reconciliation,
  });

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="space-y-2">
          <Link
            className="text-sm text-[var(--color-accent)] hover:underline"
            href="/snapshots"
          >
            {"<- Snapshots"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Snapshot {snapshot.as_of_date ?? snapshot.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
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
                <dt className="text-[var(--color-text-muted)]">Uploaded</dt>
                <dd>{formatDateTime(snapshot.uploaded_at)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Uploaded By</dt>
                <dd>{snapshot.uploaded_by_email}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Published</dt>
                <dd>{formatDateTime(snapshot.published_at)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Published By</dt>
                <dd>{snapshot.published_by_email ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Discarded</dt>
                <dd>{formatDateTime(snapshot.discarded_at)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Discarded By</dt>
                <dd>{snapshot.discarded_by_email ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Reviewed</dt>
                <dd>
                  {snapshot.reviewed_at
                    ? `${formatDateTime(snapshot.reviewed_at)} · ${snapshot.review_decision}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-muted)]">Reviewed By</dt>
                <dd>{snapshot.reviewed_by_email ?? "-"}</dd>
              </div>
              {snapshot.review_note ? (
                <div className="sm:col-span-2">
                  <dt className="text-[var(--color-text-muted)]">
                    Review Note
                  </dt>
                  <dd className="whitespace-pre-wrap">
                    {snapshot.review_note}
                  </dd>
                </div>
              ) : null}
            </dl>

            {snapshot.status === "STAGED" &&
            (currentUser.role === role_enum.REVIEWER ||
              currentUser.role === role_enum.ADMIN) &&
            snapshot.uploaded_by_email !== currentUser.email ? (
              <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                <p className="mb-2 text-sm font-medium text-[var(--color-text)]">
                  Reviewer action
                </p>
                <SnapshotReviewActions snapshotId={snapshot.id} />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {snapshot.status === "PUBLISHED" ? (
          <Card>
            <CardHeader>
              <CardTitle>Data Integrity</CardTitle>
            </CardHeader>
            <CardContent>
              {reconciliation ? (
                <div className="space-y-3 text-sm">
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Dashboard AR</dt>
                      <dd className="font-medium">
                        {formatCurrency(reconciliation.dashboard_ar, currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Source File Total</dt>
                      <dd className="font-medium">
                        {reconciliation.tally_xero_closing_ar
                          ? formatCurrency(reconciliation.tally_xero_closing_ar, currency)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-muted)]">Delta</dt>
                      <dd className="font-medium">
                        {reconciliation.delta
                          ? formatCurrency(reconciliation.delta, currency)
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  {reconciliation.status === "MATCHED" ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] px-3 py-2 text-xs text-[var(--color-status-current-text)]">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Auto-reconciled — dashboard matches source file.
                    </div>
                  ) : reconciliation.status === "MISMATCHED" ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-status-danger-border)] bg-[var(--color-status-danger-bg)] px-3 py-2 text-xs text-[var(--color-status-danger-text)]">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {`Mismatch: ${reconciliation.delta ? formatCurrency(reconciliation.delta, currency) : "unknown"} gap between dashboard and source file.`}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Source file total unavailable — reconciliation skipped.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)]">
                  {reconciliationMessage ?? "Reconciliation unavailable."}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
