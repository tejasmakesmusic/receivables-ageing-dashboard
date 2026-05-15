import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { StatusTag } from "@/components/ui/status-tag";
import {
  MetricCard,
  PageFrame,
  PageHeader,
  Panel,
} from "@/components/ui/workspace";
import { role_enum } from "@/generated/prisma/enums";
import { formatDate } from "@/lib/format";
import { requirePageRole } from "@/server/core/page-auth";
import { getStagingView, stagingQuerySchema } from "@/server/snapshots/service";
import { StagingDataTable } from "./_components/staging-data-table";
import { StagingPublishPanel } from "./_components/staging-publish-panel";
import {
  ColumnMappingPanel,
  type ColumnMappingViewModel,
} from "./_components/column-mapping-panel";
import { PartyMappingPanel } from "./_components/party-mapping-panel";
import {
  compareColumnMappings,
  getSavedColumnMapping,
} from "@/server/column-mappings/service";
import type {
  ColumnMappingResult,
  SourceHint,
} from "@/server/parsers/common";
import { getPrisma } from "@/lib/prisma";

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
  // PR C — kick a tiny meta lookup in parallel with the heavy staging
  // build so the saved-mapping fetch can start before getStagingView
  // finishes. Net win: ~150-200ms on every staging hit.
  const metaPromise = getPrisma().snapshots.findUnique({
    where: { id: snapshotId },
    select: { entity_id: true, source_hint: true },
  });
  const stagingPromise = getStagingView(snapshotId, query, currentUser);
  const savedRowPromise = metaPromise.then((meta) =>
    meta
      ? getSavedColumnMapping(meta.entity_id, meta.source_hint as SourceHint)
      : null,
  );
  const [staging, savedRow] = await Promise.all([
    stagingPromise,
    savedRowPromise,
  ]);
  const currency = staging.entity_code === "IND" ? "INR" : "AED";

  // PR 8a — drift vs. saved default surfaces in the Column Mapping panel.
  const detected =
    (staging.column_mapping as ColumnMappingViewModel | null) ?? null;
  const savedMapping = savedRow
    ? (savedRow.mapping as ColumnMappingViewModel)
    : null;
  const drift =
    detected && savedMapping
      ? compareColumnMappings(
          savedMapping as unknown as ColumnMappingResult,
          detected as unknown as ColumnMappingResult,
        )
      : [];

  const totalRows =
    staging.totals.invoices_total || staging.totals.credit_periods_total;
  const gate = staging.publish_gate;
  const needsActionCount =
    gate.unmapped_parties_count +
    gate.fuzzy_high_pending_count +
    gate.fuzzy_low_pending_count +
    gate.parse_errors_unresolved_count;

  return (
    <PageFrame>
      <PageHeader
        eyebrow={
          <Link
            className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            href={`/snapshots/${snapshotId}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Snapshot
          </Link>
        }
        title="Staging Review"
      >
        {staging.entity_code} · {staging.source_hint} ·{" "}
        {formatDate(staging.as_of_date)}
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Rows" meta="In this upload" value={totalRows} />
        <MetricCard
          label="Unmapped"
          meta="Needs canonical match"
          value={gate.unmapped_parties_count}
        />
        <MetricCard
          label="Needs Action"
          meta="Unmapped + fuzzy + errors"
          value={needsActionCount}
        />
        <MetricCard
          accent={
            <StatusTag status={gate.ok ? "GATE_OK" : "STAGING_BLOCKED"} />
          }
          label="Gate"
          meta={gate.ok ? "Ready to publish" : "Resolve blockers first"}
          value={gate.ok ? "Ready" : "Blocked"}
        />
      </section>

      {/* PR B — sticky publish gate. Keeps the analyst aware of the gate
          state and the primary action while they scroll through hundreds
          of staging rows. The negative margin extends the sticky bar to
          the page edges on wide screens. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-bg)]/85 sm:-mx-6 sm:px-6">
        <StagingPublishPanel
          parseErrorRowIndices={staging.unresolved_parse_error_row_indices}
          publishGate={gate}
          snapshotId={snapshotId}
          sourceHint={staging.source_hint}
        />
      </div>

      {staging.source_hint !== "CREDIT_PERIOD" ? (
        <PartyMappingPanel
          snapshotId={snapshotId}
          summary={staging.party_mapping_summary}
        />
      ) : null}

      <ColumnMappingPanel
        detected={detected}
        drift={drift}
        entity={staging.entity_code}
        saved={savedMapping}
        sourceHint={staging.source_hint}
      />

      <Panel>
        <StagingDataTable
          activeFilter={query.filter}
          currency={currency}
          filteredTotal={staging.pagination.total}
          gate={gate}
          limit={staging.pagination.limit}
          offset={staging.pagination.offset}
          rows={staging.rows}
          snapshotId={snapshotId}
          totalRows={totalRows}
        />
      </Panel>
    </PageFrame>
  );
}
