import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import {
  computeFileSha256,
  type EntityCode,
  type ParseResult,
  type ParsedCreditPeriodRow,
  type ParsedInvoiceRow,
  type SourceHint,
} from "@/server/parsers/common";
import { parseCreditPeriodMaster } from "@/server/parsers/credit-period";
import {
  detectSourceFromXlsx,
  validateSourceHintAgainstFile,
} from "@/server/parsers/source-detect";
import { parseTallyGrpbills } from "@/server/parsers/tally";
import { parseXeroAgedReceivables } from "@/server/parsers/xero";
import {
  resolveAlias,
  normalizePartyText,
  type AliasResolution,
  type CanonicalParty,
} from "@/server/matching/fuse-alias";
import { generateSuggestedTasks } from "@/server/collection-tasks/suggest";
import { autoResolveCascadeOnSettle } from "@/server/snapshots/auto-resolve";
import { diffInvoice } from "@/server/snapshots/invoice-diff";
import {
  invalidateAliasCorpus,
  loadCachedAliasCorpus,
} from "@/server/matching/alias-corpus-cache";
import { compareColumnMappings } from "@/server/column-mappings/service";
import { storeUploadedWorkbook } from "@/server/storage/workbooks";
import { addDaysUtc, calculateAgeing } from "@/server/ageing/buckets";
import { canResolveCreditDays } from "@/server/ageing/credit-days-check";
import { dbTransaction } from "@/lib/db-transaction";

const MATCH_TOLERANCE_CENTS = 10000n;

export const snapshotListFiltersSchema = z.object({
  entity_code: z.enum(["IND", "UAE"]).optional(),
  status: z.array(z.string().trim().min(1)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const discardSnapshotSchema = z.object({
  reason: z.string().trim().nullable().optional(),
});

export const reconciliationUpsertSchema = z.object({
  tally_xero_closing_ar: z.union([z.string(), z.number()]),
  notes: z.string().trim().nullable().optional(),
});

export const snapshotUploadSchema = z.object({
  entity_code: z.enum(["IND", "UAE"]),
  as_of_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  source_hint: z.enum(["TALLY", "XERO", "CREDIT_PERIOD"]).nullable().optional(),
});

export const stagingQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  filter: z
    .enum(["all", "ok", "parse_error", "unmapped", "fuzzy_low", "fuzzy_high", "no_credit_days"])
    .default("all"),
});

export const stagingPatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("resolve_alias"),
    canonical_id: z.string().uuid(),
    create_alias: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("create_canonical"),
    canonical_name: z.string().trim().min(1),
    alias_text: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    gstin: z
      .string()
      .trim()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
      .optional(),
    xero_contact_id: z.string().trim().min(1).optional(),
  }),
  z.object({
    action: z.literal("override_credit_days"),
    credit_days: z.number().int().min(0),
    reason: z.string().trim().optional(),
  }),
  z.object({
    action: z.literal("dismiss_parse_error"),
    reason: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("undismiss_parse_error"),
  }),
]);

export const warningsAckSchema = z.object({
  codes: z.array(z.string().trim().min(1)).min(1),
});

export type SnapshotListFilters = z.infer<typeof snapshotListFiltersSchema>;
export type DiscardSnapshotInput = z.infer<typeof discardSnapshotSchema>;
export type ReconciliationUpsertInput = z.infer<
  typeof reconciliationUpsertSchema
>;
export type SnapshotUploadInput = z.infer<typeof snapshotUploadSchema>;
export type StagingQuery = z.infer<typeof stagingQuerySchema>;
export type StagingPatchInput = z.infer<typeof stagingPatchSchema>;
export type WarningsAckInput = z.infer<typeof warningsAckSchema>;

export interface SnapshotListRow {
  id: string;
  entity_code: string;
  source_hint: string;
  status: string;
  as_of_date: string | null;
  uploaded_at: string;
  uploaded_by_email: string;
  row_count: number | null;
  total_outstanding: string | null;
  warnings_count: number | null;
}

export interface SnapshotListResponse {
  items: SnapshotListRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface SnapshotDetailResponse extends SnapshotListRow {
  published_at: string | null;
  published_by_email: string | null;
  published_as: string | null;
  discarded_at: string | null;
  discarded_by_email: string | null;
  /** PR 7 — review state. `null` until a REVIEWER acts. */
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  review_decision: "APPROVED" | "REJECTED" | null;
  review_note: string | null;
}

export interface UserRef {
  id: string;
  email: string;
}

export interface DiscardSnapshotResponse {
  snapshot_id: string;
  status: "DISCARDED";
  discarded_at: string;
  discarded_by: UserRef;
  reason: string | null;
}

export interface ReconciliationResponse {
  snapshot_id: string;
  snapshot_as_of_date: string | null;
  entity_code: "IND" | "UAE";
  dashboard_ar: string;
  exception_bucket_total: string;
  exception_bucket_breakdown: Record<string, string>;
  tally_xero_closing_ar: string | null;
  delta: string | null;
  status: "MATCHED" | "MISMATCHED" | "UNRECONCILED";
  entered_by: UserRef | null;
  entered_at: string | null;
  notes: string | null;
}

export interface SnapshotCreateResponse {
  snapshot_id: string;
  status: "STAGED";
  entity_code: EntityCode;
  source_hint: SourceHint;
  as_of_date: string | null;
  row_count: number;
  file_sha256: string;
  warnings_count: number;
  errors_count: number;
}

export interface StagingTotals {
  invoices_total: number;
  invoices_ok: number;
  invoices_parse_error: number;
  credit_periods_total: number;
  parse_warnings: number;
  parse_errors_file_level: number;
}

export interface PublishGate {
  ok: boolean;
  unmapped_parties_count: number;
  fuzzy_high_pending_count: number;
  fuzzy_low_pending_count: number;
  parse_errors_unresolved_count: number;
  warnings_unacknowledged: string[];
  role_permits_publish: boolean;
  /**
   * PR 10 — review state. NOT_REQUIRED means the entity flag is off.
   * PENDING_REVIEW blocks publish until a REVIEWER approves; REJECTED
   * blocks indefinitely until re-uploaded; APPROVED unblocks.
   */
  review_status: "NOT_REQUIRED" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  credit_days_missing_count: number;
}

export interface StagingInvoiceRow {
  row_index: number;
  status: "OK" | "PARSE_ERROR";
  party_name_raw: string;
  gstin: string | null;
  xero_contact_id: string | null;
  invoice_ref: string | null;
  invoice_date: string | null;
  amount: string | null;
  source_currency: "INR" | "AED";
  parse_error_reason: string | null;
  alias_resolution: AliasResolution;
  analyst_overrides: {
    resolved_canonical_id: string | null;
    credit_days_override: number | null;
    credit_days_source: "CONFIG" | "DEFAULT" | "MANUAL" | null;
    dismissed: boolean;
  };
  /**
   * PR C — canonical party name resolved by an analyst override.
   * Populated only when analyst_overrides.resolved_canonical_id is set;
   * lets the UI show "→ Canonical Name" on RESOLVED rows so analysts
   * can see what they mapped the raw party name to.
   */
  resolved_canonical_name: string | null;
  xero_metadata: Record<string, unknown> | null;
  raw_row_json: Record<string, unknown>;
  no_credit_days: boolean;
}

export interface StagingCreditPeriodRow {
  row_index: number;
  entity_code: EntityCode;
  name: string;
  credit_days: number;
  reason_note: string | null;
  analyst_overrides: {
    resolved_canonical_id: string | null;
    dismissed: boolean;
  };
}

export interface StagingViewResponse {
  snapshot_id: string;
  snapshot_status: string;
  entity_id: string;
  entity_code: EntityCode;
  as_of_date: string | null;
  source_hint: SourceHint;
  file_sha256: string;
  uploaded_by: string;
  uploaded_at: string;
  totals: StagingTotals;
  publish_gate: PublishGate;
  rows: Array<StagingInvoiceRow | StagingCreditPeriodRow>;
  /** PR 8a — what the parser captured for this snapshot. */
  column_mapping: ColumnMappingResultJson | null;
  /**
   * PR B — every undismissed parse-error row index across the full
   * snapshot (not just the current page). Drives the "Dismiss Parse
   * Errors" bulk action on the publish gate.
   */
  unresolved_parse_error_row_indices: number[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
  };
  /** Party mapping summary computed from all (unpaginated) staging rows. */
  party_mapping_summary: PartyMappingSummary;
}

export type PartyConflictType =
  | "duplicate_candidate"
  | "conflicting_gstin"
  | "similar_names_review";

export interface PartyGroupConflict {
  type: PartyConflictType;
  message: string;
  related_canonical_id?: string;
  related_canonical_name?: string;
}

export interface PartyGroupSummary {
  normalized_key: string;
  display_name: string;
  raw_names: string[];
  row_indices: number[];
  row_count: number;
  match_status: "EXACT" | "FUZZY_HIGH" | "FUZZY_LOW" | "UNMAPPED" | "RESOLVED";
  existing_canonical_id: string | null;
  existing_canonical_name: string | null;
  match_confidence: number | null;
  gstin: string | null;
  conflicts: PartyGroupConflict[];
  /** True when the bulk action can handle this group without manual input. */
  bulk_actionable: boolean;
}

export interface PartyMappingSummary {
  total_invoice_rows: number;
  unique_parties: number;
  already_resolved: number;
  already_existing: number;
  suggested_matches: number;
  new_to_create: number;
  unmappable_rows: number;
  fuzzy_low_count: number;
  conflict_count: number;
  /** Total staging rows that the bulk action will process. */
  bulk_actionable_count: number;
  groups: PartyGroupSummary[];
}

export interface BulkMapPartiesResult {
  snapshot_id: string;
  rows_mapped: number;
  parties_created: number;
  parties_resolved: number;
  groups_skipped: number;
  publish_gate: PublishGate;
}

export function computePartyMappingSummary(
  allRows: Array<StagingInvoiceRow | StagingCreditPeriodRow>,
): PartyMappingSummary {
  const invoiceRows = allRows.filter(
    (row): row is StagingInvoiceRow => "party_name_raw" in row,
  );

  const alreadyResolvedRows = invoiceRows.filter(
    (row) => row.analyst_overrides.resolved_canonical_id !== null,
  );
  const pendingRows = invoiceRows.filter(
    (row) => row.analyst_overrides.resolved_canonical_id === null,
  );

  type GroupAccumulator = {
    rawNames: Set<string>;
    rowIndices: number[];
    rows: StagingInvoiceRow[];
  };
  const groupMap = new Map<string, GroupAccumulator>();
  let unmappableRows = 0;

  for (const row of pendingRows) {
    if (row.status === "PARSE_ERROR") continue;
    const trimmed = row.party_name_raw.trim();
    if (!trimmed) {
      unmappableRows += 1;
      continue;
    }
    const key = normalizePartyText(trimmed);
    if (!key) {
      unmappableRows += 1;
      continue;
    }
    const group = groupMap.get(key) ?? {
      rawNames: new Set<string>(),
      rowIndices: [],
      rows: [],
    };
    group.rawNames.add(row.party_name_raw);
    group.rowIndices.push(row.row_index);
    group.rows.push(row);
    groupMap.set(key, group);
  }

  const STATE_PRIORITY: Record<string, number> = {
    EXACT: 0,
    FUZZY_HIGH: 1,
    FUZZY_LOW: 2,
    UNMAPPED: 3,
  };

  const groups: PartyGroupSummary[] = [];
  let alreadyExisting = 0;
  let suggestedMatches = 0;
  let newToCreate = 0;
  let fuzzyLowCount = 0;
  let conflictCount = 0;

  for (const [key, { rawNames, rowIndices, rows }] of groupMap) {
    // Pick the row with the best (highest-priority) alias_resolution state
    const bestRow = rows.reduce((best, row) => {
      const bestP = STATE_PRIORITY[best.alias_resolution.resolutionState] ?? 4;
      const rowP = STATE_PRIORITY[row.alias_resolution.resolutionState] ?? 4;
      return rowP < bestP ? row : best;
    });
    const resolution = bestRow.alias_resolution;
    const matchStatus = resolution.resolutionState as
      | "EXACT"
      | "FUZZY_HIGH"
      | "FUZZY_LOW"
      | "UNMAPPED";
    const topMatch = resolution.topMatches[0] ?? null;

    const conflicts: PartyGroupConflict[] = [];

    // Multiple GSTINs for the same normalized name
    const gstinsInGroup = [
      ...new Set(
        rows
          .map((r) => r.gstin)
          .filter((g): g is string => g !== null),
      ),
    ];
    if (gstinsInGroup.length > 1) {
      conflicts.push({
        type: "duplicate_candidate",
        message: `Multiple GSTINs for this party name: ${gstinsInGroup.join(", ")}`,
      });
    }

    // Different rows in the group resolve to different canonicals via EXACT match
    const exactCanonicalIds = new Set(
      rows
        .filter((r) => r.alias_resolution.resolutionState === "EXACT")
        .map((r) => r.alias_resolution.topMatches[0]?.canonicalId)
        .filter((id): id is string => id !== undefined),
    );
    if (exactCanonicalIds.size > 1) {
      conflicts.push({
        type: "conflicting_gstin",
        message: `Rows in this group match ${exactCanonicalIds.size} different existing parties — manual mapping required`,
      });
    }

    // FUZZY_LOW requires analyst review
    if (matchStatus === "FUZZY_LOW") {
      fuzzyLowCount += 1;
      conflicts.push({
        type: "similar_names_review",
        message: topMatch
          ? `Low-confidence match: "${topMatch.canonicalName}" (${topMatch.ratio.toFixed(0)}%) — review required`
          : "Low-confidence match — manual review needed",
        related_canonical_id: topMatch?.canonicalId,
        related_canonical_name: topMatch?.canonicalName,
      });
    }

    if (matchStatus === "EXACT") alreadyExisting += 1;
    else if (matchStatus === "FUZZY_HIGH") suggestedMatches += 1;
    else if (matchStatus === "UNMAPPED") newToCreate += 1;

    const hasHardConflict = conflicts.some(
      (c) => c.type !== "similar_names_review",
    );
    const bulk_actionable =
      matchStatus !== "FUZZY_LOW" &&
      !hasHardConflict &&
      (matchStatus === "EXACT" ||
        matchStatus === "FUZZY_HIGH" ||
        matchStatus === "UNMAPPED");

    if (conflicts.length > 0) conflictCount += 1;

    groups.push({
      normalized_key: key,
      display_name: [...rawNames][0] ?? rows[0].party_name_raw,
      raw_names: [...rawNames],
      row_indices: rowIndices,
      row_count: rowIndices.length,
      match_status: matchStatus,
      existing_canonical_id: topMatch?.canonicalId ?? null,
      existing_canonical_name: topMatch?.canonicalName ?? null,
      match_confidence: topMatch?.ratio ?? null,
      gstin: gstinsInGroup[0] ?? null,
      conflicts,
      bulk_actionable,
    });
  }

  const bulkActionableCount = groups
    .filter((g) => g.bulk_actionable)
    .reduce((sum, g) => sum + g.row_count, 0);

  return {
    total_invoice_rows: invoiceRows.length,
    unique_parties: groupMap.size,
    already_resolved: alreadyResolvedRows.length,
    already_existing: alreadyExisting,
    suggested_matches: suggestedMatches,
    new_to_create: newToCreate,
    unmappable_rows: unmappableRows,
    fuzzy_low_count: fuzzyLowCount,
    conflict_count: conflictCount,
    bulk_actionable_count: bulkActionableCount,
    groups,
  };
}

type ColumnMappingResultJson = {
  source_hint: string;
  layout_variant: string;
  fields: Record<
    string,
    { source: string | null; confidence: "EXACT" | "HEURISTIC" | "MISSING" }
  >;
};

export interface StagingPatchResponse {
  row: StagingInvoiceRow | StagingCreditPeriodRow;
  publish_gate: PublishGate;
}

export interface WarningsAckResponse {
  acknowledged: string[];
  publish_gate: PublishGate;
}

export interface PublishSnapshotResponse {
  snapshot_id: string;
  status: "PUBLISHED";
  published_at: string;
  published_as: "NORMAL" | "OVERRIDE";
  invoices_upserted: number;
  invoice_snapshots_created: number;
  invoices_settled: number;
  /** PR 2: per-table counts of auto-resolved operational objects. */
  auto_resolved?: {
    promises_to_pay: number;
    dispute_cases: number;
    collection_tasks: number;
    exception_tags: number;
  };
  /** PR 3: invoice field changes captured during publish. */
  changes_detected?: {
    total: number;
    by_field: Record<string, number>;
  };
  credit_period_configs_written?: number;
}

type StagingOverride = {
  row_index: number;
  action: StagingPatchInput["action"] | "warnings_ack";
  resolved_canonical_id?: string;
  credit_days_override?: number;
  credit_days_source?: "MANUAL";
  dismissed?: boolean;
  reason?: string;
  created_at: string;
  actor_id: string;
};

type SerializedParseResult = Omit<
  ParseResult,
  "as_of_date" | "invoices" | "credit_periods"
> & {
  as_of_date: string | null;
  invoices: Array<
    Omit<ParsedInvoiceRow, "invoice_date"> & { invoice_date: string | null }
  >;
  credit_periods: ParsedCreditPeriodRow[];
};

type DecimalLike = string | number | null | { toString: () => string };

type SnapshotRow = Prisma.snapshotsGetPayload<{
  include: {
    entities: { select: { code: true } };
    users_snapshots_uploaded_byTousers: { select: { email: true } };
    users_snapshots_published_byTousers: { select: { email: true } };
    users_snapshots_discarded_byTousers: { select: { email: true } };
    users_snapshots_reviewed_byTousers: { select: { email: true } };
  };
}>;

function snapshotInclude() {
  return {
    entities: { select: { code: true } },
    users_snapshots_uploaded_byTousers: { select: { email: true } },
    users_snapshots_published_byTousers: { select: { email: true } },
    users_snapshots_discarded_byTousers: { select: { email: true } },
    users_snapshots_reviewed_byTousers: { select: { email: true } },
  } satisfies Prisma.snapshotsInclude;
}

function formatDecimal(value: DecimalLike): string {
  if (value == null) return "0.00";
  if (typeof value === "number") return value.toFixed(2);
  return value.toString();
}

function parseToCents(value: DecimalLike): bigint {
  const text = formatDecimal(value).trim().replace(/,/g, "");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return 0n;

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  return sign * (whole * 100n + BigInt(fraction || "0"));
}

function formatFromCents(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  return `${sign}${whole.toString()}.${cents}`;
}

function toDate(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toDateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function requireAnalystScope(user: AuthenticatedUser): void {
  if (user.role === role_enum.ANALYST && !user.entityIdScope) {
    throw new ForbiddenError("Analyst user has no entity scope");
  }
}

async function assertSnapshotAccess(
  snapshotId: string,
  currentUser: AuthenticatedUser,
): Promise<SnapshotRow> {
  const snapshot = await getPrisma().snapshots.findUnique({
    where: { id: snapshotId },
    include: snapshotInclude(),
  });

  if (!snapshot) {
    throw new HttpError("not_found", 404, "Snapshot not found");
  }

  await assertAnalystCanAccessEntity(currentUser, snapshot.entity_id);
  return snapshot;
}

// PR C — slimmed-down variant for the staging view. The full
// assertSnapshotAccess joins five user tables (uploaded/published/
// discarded/reviewed) for the detail page, which cost ~1s over Neon.
// Staging only ever reads `entities.code` + `users_snapshots_uploaded_byTousers.email`,
// so the other three JOINs are dead weight. This shaves ~400-600ms off
// every staging page hit.
const stagingSnapshotInclude = {
  entities: { select: { code: true } },
  users_snapshots_uploaded_byTousers: { select: { email: true } },
} satisfies Prisma.snapshotsInclude;

type StagingSnapshotRow = Prisma.snapshotsGetPayload<{
  include: typeof stagingSnapshotInclude;
}>;

async function loadSnapshotForStaging(
  snapshotId: string,
  currentUser: AuthenticatedUser,
): Promise<StagingSnapshotRow> {
  const snapshot = await getPrisma().snapshots.findUnique({
    where: { id: snapshotId },
    include: stagingSnapshotInclude,
  });
  if (!snapshot) {
    throw new HttpError("not_found", 404, "Snapshot not found");
  }
  await assertAnalystCanAccessEntity(currentUser, snapshot.entity_id);
  return snapshot;
}

function parseResultWarningsCount(parseResultJson: unknown): number | null {
  if (!parseResultJson || typeof parseResultJson !== "object") return null;
  const result = parseResultJson as Record<string, unknown>;
  const warnings = result.warnings;
  if (!Array.isArray(warnings)) return null;
  return warnings.length;
}

function toListRow(snapshot: SnapshotRow): SnapshotListRow {
  return {
    id: snapshot.id,
    entity_code: snapshot.entities.code,
    source_hint: snapshot.source_hint,
    status: snapshot.status,
    as_of_date: toDate(snapshot.as_of_date),
    uploaded_at: snapshot.uploaded_at.toISOString(),
    uploaded_by_email: snapshot.users_snapshots_uploaded_byTousers.email,
    row_count: snapshot.row_count,
    total_outstanding: snapshot.total_outstanding
      ? formatDecimal(snapshot.total_outstanding)
      : null,
    warnings_count: parseResultWarningsCount(snapshot.parse_result_json),
  };
}

function toDetailRow(snapshot: SnapshotRow): SnapshotDetailResponse {
  return {
    ...toListRow(snapshot),
    published_at: toDateTime(snapshot.published_at),
    published_by_email:
      snapshot.users_snapshots_published_byTousers?.email ?? null,
    published_as: snapshot.published_as,
    discarded_at: toDateTime(snapshot.discarded_at),
    discarded_by_email:
      snapshot.users_snapshots_discarded_byTousers?.email ?? null,
    reviewed_at: toDateTime(snapshot.reviewed_at),
    reviewed_by_email:
      snapshot.users_snapshots_reviewed_byTousers?.email ?? null,
    review_decision:
      snapshot.review_decision === "APPROVED" ||
      snapshot.review_decision === "REJECTED"
        ? snapshot.review_decision
        : null,
    review_note: snapshot.review_note,
  };
}

function parseTallyAr(value: string | number): string {
  const cents = parseToCents(value);
  return formatFromCents(cents);
}

function serializeParseResult(result: ParseResult): SerializedParseResult {
  return {
    ...result,
    as_of_date: toDate(result.as_of_date),
    invoices: result.invoices.map((row) => ({
      ...row,
      invoice_date: toDate(row.invoice_date),
    })),
    credit_periods: result.credit_periods,
  };
}

function asParseResult(value: unknown): SerializedParseResult {
  if (!value || typeof value !== "object") {
    throw new HttpError(
      "parse_result_missing",
      500,
      "Snapshot parse result is missing",
    );
  }

  return value as SerializedParseResult;
}

function parseDateInput(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function parseSnapshotSource(
  fileBytes: Uint8Array,
  body: SnapshotUploadInput,
  options: { xeroOverride?: import("@/server/parsers/xero").XeroColumnOverride } = {},
): { sourceHint: SourceHint; parseResult: ParseResult } {
  const detected = body.source_hint ?? detectSourceFromXlsx(fileBytes);
  if (!detected) {
    throw new HttpError(
      "source_not_detected",
      400,
      "Could not detect workbook source",
    );
  }

  if (body.source_hint) {
    validateSourceHintAgainstFile(fileBytes, body.source_hint);
  }

  const parseResult =
    detected === "TALLY"
      ? parseTallyGrpbills(fileBytes)
      : detected === "XERO"
        ? parseXeroAgedReceivables(fileBytes, options.xeroOverride ?? {})
        : parseCreditPeriodMaster(fileBytes);

  return { sourceHint: detected, parseResult };
}

/**
 * PR 8b — convert a saved column_mappings row into the per-parser override
 * shape. Currently only Xero parsers consume overrides. Tally is
 * auto-detected from layout.
 */
function buildParserOverrideFromSaved(
  sourceHint: SourceHint,
  saved:
    | {
        mapping: import("@/server/parsers/common").ColumnMappingResult;
      }
    | null,
): { xeroOverride?: import("@/server/parsers/xero").XeroColumnOverride } {
  if (sourceHint !== "XERO" || !saved) return {};
  const fields = saved.mapping.fields ?? {};
  const out: import("@/server/parsers/xero").XeroColumnOverride = {};
  const map: Array<
    [string, keyof import("@/server/parsers/xero").XeroColumnOverride]
  > = [
    ["contact_account_number", "contact_account_number"],
    ["invoice_date", "invoice_date"],
    ["invoice_ref", "invoice_ref"],
    ["total", "total"],
    ["invoice_seen", "invoice_seen"],
    ["invoice_sent", "invoice_sent"],
    ["project_id", "project_id"],
    ["service_month", "service_month"],
    ["primary_person", "primary_person"],
    ["email", "email"],
  ];
  for (const [savedKey, overrideKey] of map) {
    const f = fields[savedKey];
    if (f && typeof f.source === "string" && f.source.length) {
      out[overrideKey] = f.source;
    }
  }
  return { xeroOverride: out };
}

function snapshotRowCount(result: ParseResult): number {
  return result.source_hint === "CREDIT_PERIOD"
    ? result.credit_periods.length
    : result.invoices.length;
}

function snapshotOutstanding(result: ParseResult): string | null {
  if (result.source_hint === "CREDIT_PERIOD") {
    return null;
  }

  const total = result.invoices.reduce((acc, row) => {
    if (row.status !== "OK") {
      return acc;
    }

    return acc + parseToCents(row.amount);
  }, 0n);

  return formatFromCents(total);
}

function normalizeWarningsAck(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function normalizeOverrides(value: unknown): StagingOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is StagingOverride => {
    return (
      typeof item === "object" &&
      item !== null &&
      "row_index" in item &&
      typeof (item as { row_index?: unknown }).row_index === "number"
    );
  });
}

function effectiveOverride(
  overrides: StagingOverride[],
  rowIndex: number,
): {
  resolved_canonical_id: string | null;
  credit_days_override: number | null;
  credit_days_source: "CONFIG" | "DEFAULT" | "MANUAL" | null;
  dismissed: boolean;
} {
  const state = {
    resolved_canonical_id: null as string | null,
    credit_days_override: null as number | null,
    credit_days_source: null as "CONFIG" | "DEFAULT" | "MANUAL" | null,
    dismissed: false,
  };

  for (const override of overrides.filter(
    (item) => item.row_index === rowIndex,
  )) {
    if (override.resolved_canonical_id) {
      state.resolved_canonical_id = override.resolved_canonical_id;
    }
    if (typeof override.credit_days_override === "number") {
      state.credit_days_override = override.credit_days_override;
      state.credit_days_source = "MANUAL";
    }
    if (typeof override.dismissed === "boolean") {
      state.dismissed = override.dismissed;
    }
  }

  return state;
}

// PR C+ — staging hits this every page load. Delegate to the cached
// loader so warm hits skip the ~500ms Neon round-trip. Mutations in
// patchStagingRow (create_canonical, resolve_alias with create_alias)
// call invalidateAliasCorpus(entityId) so the cache stays correct.
async function loadAliasCorpus(entityId: string): Promise<CanonicalParty[]> {
  return loadCachedAliasCorpus(entityId);
}

function gateFromRows(params: {
  sourceHint: SourceHint;
  rows: Array<StagingInvoiceRow | StagingCreditPeriodRow>;
  warnings: string[];
  acknowledged: string[];
  currentUser: AuthenticatedUser;
  /** PR 10 — entity flag + snapshot review state. */
  reviewRequired: boolean;
  reviewDecision: string | null;
}): PublishGate {
  const unacknowledged = params.warnings.filter(
    (code) => !params.acknowledged.includes(code),
  );
  const invoiceRows = params.rows.filter(
    (row): row is StagingInvoiceRow => "party_name_raw" in row,
  );
  const parseErrorsUnresolved = invoiceRows.filter(
    (row) => row.status === "PARSE_ERROR" && !row.analyst_overrides.dismissed,
  ).length;
  const unmapped = invoiceRows.filter(
    (row) =>
      row.status === "OK" &&
      !row.analyst_overrides.resolved_canonical_id &&
      row.alias_resolution.resolutionState === "UNMAPPED",
  ).length;
  const fuzzyHigh = invoiceRows.filter(
    (row) =>
      row.status === "OK" &&
      !row.analyst_overrides.resolved_canonical_id &&
      row.alias_resolution.resolutionState === "FUZZY_HIGH",
  ).length;
  const fuzzyLow = invoiceRows.filter(
    (row) =>
      row.status === "OK" &&
      !row.analyst_overrides.resolved_canonical_id &&
      row.alias_resolution.resolutionState === "FUZZY_LOW",
  ).length;
  const rolePermits =
    params.currentUser.role === role_enum.ANALYST ||
    params.currentUser.role === role_enum.ADMIN;

  // PR 10 — derive review_status. When the entity flag is off, review is
  // a soft signal; the gate ignores it. When on, anything other than
  // APPROVED blocks publish.
  let reviewStatus: PublishGate["review_status"];
  if (!params.reviewRequired) {
    reviewStatus = "NOT_REQUIRED";
  } else if (params.reviewDecision === "APPROVED") {
    reviewStatus = "APPROVED";
  } else if (params.reviewDecision === "REJECTED") {
    reviewStatus = "REJECTED";
  } else {
    reviewStatus = "PENDING_REVIEW";
  }
  const reviewBlocks =
    params.reviewRequired && reviewStatus !== "APPROVED";

  const creditDaysMissing = invoiceRows.filter((r) => r.no_credit_days).length;

  return {
    ok:
      rolePermits &&
      unacknowledged.length === 0 &&
      parseErrorsUnresolved === 0 &&
      unmapped === 0 &&
      fuzzyHigh === 0 &&
      fuzzyLow === 0 &&
      creditDaysMissing === 0 &&
      !reviewBlocks,
    unmapped_parties_count: unmapped,
    fuzzy_high_pending_count: fuzzyHigh,
    fuzzy_low_pending_count: fuzzyLow,
    parse_errors_unresolved_count: parseErrorsUnresolved,
    credit_days_missing_count: creditDaysMissing,
    warnings_unacknowledged: unacknowledged,
    role_permits_publish: rolePermits,
    review_status: reviewStatus,
  };
}

async function computeReconciliationParts(snapshot: SnapshotRow): Promise<{
  dashboardAr: string;
  exceptionBucketTotal: string;
  exceptionBucketBreakdown: Record<string, string>;
}> {
  const prisma = getPrisma();
  const snapshotWhere = {
    snapshot_id: snapshot.id,
    ...(snapshot.as_of_date ? { as_of_date: snapshot.as_of_date } : {}),
  };

  const invoiceSnapshots = await prisma.invoice_snapshots.findMany({
    where: snapshotWhere,
    select: {
      invoice_id: true,
      outstanding_amount: true,
      invoices: {
        select: {
          exception_tags: {
            where: { status: "ACTIVE" },
            select: {
              exception_bucket_types: { select: { code: true } },
            },
          },
        },
      },
    },
  });

  let dashboardArCents = 0n;
  let exceptionTotalCents = 0n;
  const breakdown = new Map<string, bigint>();

  for (const row of invoiceSnapshots) {
    const amountCents = parseToCents(row.outstanding_amount);
    dashboardArCents += amountCents;

    const activeTags = row.invoices.exception_tags;
    if (activeTags.length === 0) {
      continue;
    }

    exceptionTotalCents += amountCents;
    for (const tag of activeTags) {
      const code = tag.exception_bucket_types.code;
      breakdown.set(code, (breakdown.get(code) ?? 0n) + amountCents);
    }
  }

  return {
    dashboardAr: formatFromCents(dashboardArCents),
    exceptionBucketTotal: formatFromCents(exceptionTotalCents),
    exceptionBucketBreakdown: Object.fromEntries(
      [...breakdown.entries()].map(([key, value]) => [
        key,
        formatFromCents(value),
      ]),
    ),
  };
}

function reconciliationStatus(deltaCents: bigint): "MATCHED" | "MISMATCHED" {
  const absolute = deltaCents < 0n ? -deltaCents : deltaCents;
  return absolute <= MATCH_TOLERANCE_CENTS ? "MATCHED" : "MISMATCHED";
}

export async function listSnapshots(
  filters: SnapshotListFilters,
  currentUser: AuthenticatedUser,
): Promise<SnapshotListResponse> {
  requireAnalystScope(currentUser);
  const where: Prisma.snapshotsWhereInput = {
    ...(currentUser.role === role_enum.ANALYST && currentUser.entityIdScope
      ? { entity_id: currentUser.entityIdScope }
      : {}),
    ...(filters.entity_code
      ? { entities: { is: { code: filters.entity_code } } }
      : {}),
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
  };

  const prisma = getPrisma();
  const [total, rows] = await Promise.all([
    prisma.snapshots.count({ where }),
    prisma.snapshots.findMany({
      where,
      include: snapshotInclude(),
      orderBy: { uploaded_at: "desc" },
      skip: (filters.page - 1) * filters.page_size,
      take: filters.page_size,
    }),
  ]);

  return {
    items: rows.map(toListRow),
    total,
    page: filters.page,
    page_size: filters.page_size,
  };
}

export async function getSnapshotDetail(
  snapshotId: string,
  currentUser: AuthenticatedUser,
): Promise<SnapshotDetailResponse> {
  return toDetailRow(await assertSnapshotAccess(snapshotId, currentUser));
}

export async function createSnapshotFromUpload(params: {
  fileBytes: Uint8Array;
  fileName: string;
  body: SnapshotUploadInput;
  currentUser: AuthenticatedUser;
}): Promise<SnapshotCreateResponse> {
  const prisma = getPrisma();
  const entity = await prisma.entities.findUnique({
    where: { code: params.body.entity_code },
    select: { id: true, code: true },
  });

  if (!entity) {
    throw new HttpError("not_found", 404, "Entity not found");
  }

  await assertAnalystCanAccessEntity(params.currentUser, entity.id);

  const fileSha256 = computeFileSha256(params.fileBytes);
  const duplicate = await prisma.snapshots.findUnique({
    where: { upload_file_sha256: fileSha256 },
    select: { id: true },
  });

  if (duplicate) {
    throw new HttpError(
      "duplicate_snapshot",
      409,
      "This file has already been uploaded",
    );
  }

  // PR 8b — if the analyst (or auto-save) has previously saved a column
  // mapping for this entity + source, apply it as an override on parse.
  // Two-pass: detect once cheaply via source-detect, then look up + parse.
  const detectedHint =
    params.body.source_hint ?? detectSourceFromXlsx(params.fileBytes);
  let xeroOverride: import("@/server/parsers/xero").XeroColumnOverride | undefined;
  if (detectedHint === "XERO") {
    const saved = await prisma.column_mappings.findUnique({
      where: {
        entity_id_source_hint: {
          entity_id: entity.id,
          source_hint: "XERO",
        },
      },
      select: { mapping_json: true },
    });
    if (saved?.mapping_json) {
      const built = buildParserOverrideFromSaved(
        "XERO",
        {
          mapping:
            saved.mapping_json as unknown as import("@/server/parsers/common").ColumnMappingResult,
        },
      );
      xeroOverride = built.xeroOverride;
    }
  }
  const { sourceHint, parseResult } = parseSnapshotSource(
    params.fileBytes,
    params.body,
    { xeroOverride },
  );
  const effectiveAsOf =
    params.body.as_of_date ??
    (parseResult.as_of_date ? toDate(parseResult.as_of_date) : null);

  if (sourceHint !== "CREDIT_PERIOD" && !effectiveAsOf) {
    throw new HttpError(
      "as_of_date_required",
      422,
      "as_of_date is required for receivables snapshots",
    );
  }

  const snapshotId = createId();
  const rowCount = snapshotRowCount(parseResult);
  const totalOutstanding = snapshotOutstanding(parseResult);
  const storedWorkbook = await storeUploadedWorkbook({
    fileBytes: params.fileBytes,
    fileName: params.fileName,
    entityCode: entity.code as EntityCode,
    snapshotId,
    fileSha256,
  });

  // PR 8a — compare detected mapping against any saved default for this
  // (entity, source). If they differ, drop a `column_mapping_drift`
  // warning into the parse result so the staging gate surfaces it.
  const detectedMapping = parseResult.column_mapping ?? null;
  if (detectedMapping) {
    const saved = await prisma.column_mappings.findUnique({
      where: {
        entity_id_source_hint: {
          entity_id: entity.id,
          source_hint: sourceHint,
        },
      },
      select: { mapping_json: true },
    });
    if (saved && saved.mapping_json) {
      const drift = compareColumnMappings(
        saved.mapping_json as unknown as typeof detectedMapping,
        detectedMapping,
      );
      if (drift.length > 0) {
        parseResult.warnings.push({
          row_index: -1,
          code: "COLUMN_MAPPING_DRIFT",
          message: `Detected mapping differs from saved default for ${sourceHint}: ${drift.join(", ")}`,
        });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.snapshots.create({
      data: {
        id: snapshotId,
        entity_id: entity.id,
        uploaded_by: params.currentUser.id,
        upload_file_path: storedWorkbook.uri,
        upload_file_sha256: fileSha256,
        as_of_date: parseDateInput(effectiveAsOf),
        source_hint: sourceHint,
        status: "STAGED",
        row_count: rowCount,
        total_outstanding: totalOutstanding
          ? new Prisma.Decimal(totalOutstanding)
          : null,
        parse_result_json: serializeParseResult(
          parseResult,
        ) as unknown as Prisma.InputJsonValue,
        column_mapping_json: detectedMapping
          ? (detectedMapping as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        warnings_acknowledged_json: [],
        staging_overrides_json: [],
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: params.currentUser.id,
        action: "snapshot.create",
        entity_type: "snapshots",
        entity_id: snapshotId,
        before: Prisma.JsonNull,
        after: {
          entity_code: entity.code,
          source_hint: sourceHint,
          as_of_date: effectiveAsOf,
          row_count: rowCount,
          file_sha256: fileSha256,
          upload_file_path: storedWorkbook.uri,
          workbook_storage_key: storedWorkbook.key,
          workbook_stored: storedWorkbook.stored,
        },
      },
    });
  });

  return {
    snapshot_id: snapshotId,
    status: "STAGED",
    entity_code: entity.code as EntityCode,
    source_hint: sourceHint,
    as_of_date: effectiveAsOf,
    row_count: rowCount,
    file_sha256: fileSha256,
    warnings_count: parseResult.warnings.length,
    errors_count: parseResult.errors.length,
  };
}

async function buildStagingRows(
  snapshot: SnapshotRow | StagingSnapshotRow,
  currentUser: AuthenticatedUser,
): Promise<{
  rows: Array<StagingInvoiceRow | StagingCreditPeriodRow>;
  totals: StagingTotals;
  gate: PublishGate;
}> {
  const parseResult = asParseResult(snapshot.parse_result_json);
  const overrides = normalizeOverrides(snapshot.staging_overrides_json);
  const acknowledged = normalizeWarningsAck(
    snapshot.warnings_acknowledged_json,
  );
  const warningCodes = parseResult.warnings.map((warning) => warning.code);
  // PR C — fetch the alias corpus + entity gate metadata in parallel. Each
  // is a remote-Neon round trip (~100-300ms) and they're independent;
  // running them concurrently shaves ~150ms off the SSR for every staging
  // page hit.
  const [parties, entityForGate] = await Promise.all([
    loadAliasCorpus(snapshot.entity_id),
    getPrisma().entities.findUnique({
      where: { id: snapshot.entity_id },
      select: { require_review_before_publish: true, default_credit_days: true },
    }),
  ]);
  // PR C — map canonical-id → name so we can attach the resolved party
  // name to rows that were override-resolved. Cheap (in-memory).
  const partyById = new Map(
    parties.map((p) => [p.canonicalId, p.canonicalName]),
  );

  const invoiceRows: StagingInvoiceRow[] = parseResult.invoices.map((row) => {
    const override = effectiveOverride(overrides, row.row_index);
    const aliasResolution = override.resolved_canonical_id
      ? {
          rawName: row.party_name_raw,
          resolutionState: "EXACT" as const,
          topMatches: [],
        }
      : resolveAlias(row.party_name_raw, parties, {
          gstin: row.gstin,
          xeroContactId: row.xero_contact_id,
        });

    return {
      row_index: row.row_index,
      status: row.status,
      party_name_raw: row.party_name_raw,
      gstin: row.gstin,
      xero_contact_id: row.xero_contact_id,
      invoice_ref: row.invoice_ref,
      invoice_date: row.invoice_date,
      amount: row.amount,
      source_currency: row.source_currency,
      parse_error_reason: row.parse_error_reason,
      alias_resolution: aliasResolution,
      analyst_overrides: override,
      resolved_canonical_name: override.resolved_canonical_id
        ? (partyById.get(override.resolved_canonical_id) ?? null)
        : null,
      xero_metadata: row.xero_metadata
        ? (row.xero_metadata as unknown as Record<string, unknown>)
        : null,
      raw_row_json: row.raw_row_json,
      no_credit_days: false,
    };
  });

  const resolvedCanonicalIds = [
    ...new Set(
      invoiceRows
        .filter((r) => r.status === "OK")
        .map(
          (r) =>
            r.analyst_overrides.resolved_canonical_id ??
            (r.alias_resolution.resolutionState === "EXACT"
              ? r.alias_resolution.topMatches[0]?.canonicalId
              : null),
        )
        .filter((id): id is string => id !== null),
    ),
  ];

  const creditPeriodConfigs =
    resolvedCanonicalIds.length > 0
      ? await getPrisma().credit_period_config.findMany({
          where: { canonical_id: { in: resolvedCanonicalIds } },
          select: { canonical_id: true, valid_from: true, valid_to: true },
        })
      : [];

  const entityDefaultDays = entityForGate?.default_credit_days ?? null;

  for (const row of invoiceRows) {
    if (row.status !== "OK") continue;
    const canonicalId =
      row.analyst_overrides.resolved_canonical_id ??
      (row.alias_resolution.resolutionState === "EXACT"
        ? row.alias_resolution.topMatches[0]?.canonicalId
        : null);
    if (!canonicalId) continue;
    const invoiceDate = parseDateInput(row.invoice_date);
    if (!invoiceDate) continue;
    row.no_credit_days = !canResolveCreditDays({
      canonicalId,
      invoiceDate,
      creditDaysOverride: row.analyst_overrides.credit_days_override,
      entityDefaultDays,
      configs: creditPeriodConfigs,
    });
  }

  const creditRows: StagingCreditPeriodRow[] = parseResult.credit_periods.map(
    (row) => ({
      row_index: row.row_index,
      entity_code: row.entity_code,
      name: row.name,
      credit_days: row.credit_days,
      reason_note: row.reason_note,
      analyst_overrides: {
        resolved_canonical_id: effectiveOverride(overrides, row.row_index)
          .resolved_canonical_id,
        dismissed: effectiveOverride(overrides, row.row_index).dismissed,
      },
    }),
  );

  const rows =
    snapshot.source_hint === "CREDIT_PERIOD"
      ? creditRows
      : (invoiceRows as Array<StagingInvoiceRow | StagingCreditPeriodRow>);
  const totals: StagingTotals = {
    invoices_total: parseResult.invoices.length,
    invoices_ok: parseResult.invoices.filter((row) => row.status === "OK")
      .length,
    invoices_parse_error: parseResult.invoices.filter(
      (row) => row.status === "PARSE_ERROR",
    ).length,
    credit_periods_total: parseResult.credit_periods.length,
    parse_warnings: parseResult.warnings.length,
    parse_errors_file_level: parseResult.errors.length,
  };
  // PR 10 — entityForGate is loaded above in parallel with parties.
  const gate = gateFromRows({
    sourceHint: snapshot.source_hint as SourceHint,
    rows,
    warnings: warningCodes,
    acknowledged,
    currentUser,
    reviewRequired: entityForGate?.require_review_before_publish ?? false,
    reviewDecision: snapshot.review_decision ?? null,
  });

  return { rows, totals, gate };
}

function filterStagingRows(
  rows: Array<StagingInvoiceRow | StagingCreditPeriodRow>,
  filter: StagingQuery["filter"],
): Array<StagingInvoiceRow | StagingCreditPeriodRow> {
  if (filter === "all") return rows;
  if (filter === "ok")
    return rows.filter((row) => "status" in row && row.status === "OK");
  if (filter === "parse_error") {
    return rows.filter(
      (row) => "status" in row && row.status === "PARSE_ERROR",
    );
  }

  if (filter === "no_credit_days") {
    return rows.filter(
      (row): row is StagingInvoiceRow =>
        "no_credit_days" in row && (row as StagingInvoiceRow).no_credit_days,
    );
  }

  return rows.filter((row) => {
    if (!("alias_resolution" in row)) return false;
    if (filter === "unmapped") {
      return row.alias_resolution.resolutionState === "UNMAPPED";
    }
    if (filter === "fuzzy_low") {
      return row.alias_resolution.resolutionState === "FUZZY_LOW";
    }
    return row.alias_resolution.resolutionState === "FUZZY_HIGH";
  });
}

export async function getStagingView(
  snapshotId: string,
  query: StagingQuery,
  currentUser: AuthenticatedUser,
): Promise<StagingViewResponse> {
  // PR C — use the slim staging loader (~400-600ms faster than the full
  // assertSnapshotAccess which JOINs 5 user tables we don't need here).
  const snapshot = await loadSnapshotForStaging(snapshotId, currentUser);
  if (snapshot.status !== "STAGED") {
    throw new HttpError(
      "snapshot_not_staged",
      409,
      "Staging review is only available for STAGED snapshots",
    );
  }

  const { rows, totals, gate } = await buildStagingRows(snapshot, currentUser);
  const filtered = filterStagingRows(rows, query.filter);

  // PR B — collect every undismissed parse-error row index across the full
  // (unpaginated, unfiltered) staging set so the publish-gate bulk action
  // can target them regardless of what page the analyst is on.
  const unresolvedParseErrorRowIndices = rows
    .filter(
      (row): row is StagingInvoiceRow =>
        "status" in row &&
        row.status === "PARSE_ERROR" &&
        !row.analyst_overrides.dismissed,
    )
    .map((row) => row.row_index);

  return {
    snapshot_id: snapshot.id,
    snapshot_status: snapshot.status,
    entity_id: snapshot.entity_id,
    entity_code: snapshot.entities.code as EntityCode,
    as_of_date: toDate(snapshot.as_of_date),
    source_hint: snapshot.source_hint as SourceHint,
    file_sha256: snapshot.upload_file_sha256,
    uploaded_by: snapshot.users_snapshots_uploaded_byTousers.email,
    uploaded_at: snapshot.uploaded_at.toISOString(),
    totals,
    publish_gate: gate,
    rows: filtered.slice(query.offset, query.offset + query.limit),
    column_mapping:
      (snapshot.column_mapping_json as ColumnMappingResultJson | null) ?? null,
    unresolved_parse_error_row_indices: unresolvedParseErrorRowIndices,
    pagination: {
      offset: query.offset,
      limit: query.limit,
      total: filtered.length,
    },
    party_mapping_summary: computePartyMappingSummary(rows),
  };
}

export async function patchStagingRow(
  snapshotId: string,
  rowIndex: number,
  body: StagingPatchInput,
  currentUser: AuthenticatedUser,
): Promise<StagingPatchResponse> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "STAGED") {
    throw new HttpError("snapshot_not_staged", 409, "Snapshot is not STAGED");
  }

  const parseResult = asParseResult(snapshot.parse_result_json);
  const targetCreditPeriodRow = parseResult.credit_periods.find(
    (row) => row.row_index === rowIndex,
  );
  const hasRow =
    parseResult.invoices.some((row) => row.row_index === rowIndex) ||
    Boolean(targetCreditPeriodRow);
  if (!hasRow) {
    throw new HttpError("row_not_found", 404, "Staging row not found");
  }

  if (
    snapshot.source_hint === "CREDIT_PERIOD" &&
    (body.action === "override_credit_days" ||
      body.action === "dismiss_parse_error" ||
      body.action === "undismiss_parse_error")
  ) {
    throw new HttpError(
      "invalid_credit_period_staging_action",
      422,
      `${body.action} is not valid on CREDIT_PERIOD snapshots`,
    );
  }

  let targetEntityId = snapshot.entity_id;
  if (targetCreditPeriodRow) {
    const targetEntity = await getPrisma().entities.findUnique({
      where: { code: targetCreditPeriodRow.entity_code },
      select: { id: true },
    });
    if (!targetEntity) {
      throw new HttpError(
        "entity_missing",
        500,
        "Credit-period row entity is missing",
      );
    }
    await assertAnalystCanAccessEntity(currentUser, targetEntity.id);
    targetEntityId = targetEntity.id;
  }

  const now = new Date().toISOString();
  const override: StagingOverride = {
    row_index: rowIndex,
    action: body.action,
    created_at: now,
    actor_id: currentUser.id,
  };

  await getPrisma().$transaction(async (tx) => {
    // PR C — fix the read-modify-write race that PR B's bulk dismiss
    // exposed. The original implementation read staging_overrides_json
    // BEFORE the transaction, then wrote `[...preTxOverrides, override]`
    // back inside. Two concurrent callers both saw the same pre-tx state,
    // each appended its own override, and the last update silently
    // overwrote the other. Now we acquire a row-level lock on the
    // snapshot first and re-read inside the transaction so appends
    // serialise correctly.
    const lockedRows = await tx.$queryRawUnsafe<
      { staging_overrides_json: unknown }[]
    >(
      `SELECT staging_overrides_json FROM snapshots WHERE id = $1::uuid FOR UPDATE`,
      snapshot.id,
    );
    const latestOverrides = normalizeOverrides(
      lockedRows[0]?.staging_overrides_json,
    );

    if (body.action === "resolve_alias") {
      const canonical = await tx.parties_canonical.findUnique({
        where: { id: body.canonical_id },
        select: { id: true, entity_id: true },
      });
      if (!canonical || canonical.entity_id !== targetEntityId) {
        throw new HttpError(
          "canonical_not_found",
          404,
          "Canonical party not found",
        );
      }
      override.resolved_canonical_id = canonical.id;

      const rawName =
        parseResult.invoices.find((row) => row.row_index === rowIndex)
          ?.party_name_raw ?? targetCreditPeriodRow?.name;
      if (body.create_alias && rawName) {
        await tx.party_aliases
          .create({
            data: {
              id: createId(),
              canonical_id: canonical.id,
              alias_text: rawName,
              source: "MANUAL",
              confidence: new Prisma.Decimal("100"),
              confirmed_by: currentUser.id,
              confirmed_at: new Date(),
              created_by: currentUser.id,
            },
          })
          .catch(() => undefined);
      }
    } else if (body.action === "create_canonical") {
      const canonical = await tx.parties_canonical.create({
        data: {
          id: createId(),
          entity_id: targetEntityId,
          name: body.canonical_name,
          gstin: body.gstin ?? null,
          xero_contact_id: body.xero_contact_id ?? null,
          notes: body.notes ?? null,
          created_by: currentUser.id,
        },
      });
      const rawName =
        body.alias_text ||
        parseResult.invoices.find((row) => row.row_index === rowIndex)
          ?.party_name_raw ||
        targetCreditPeriodRow?.name ||
        body.canonical_name;
      await tx.party_aliases.create({
        data: {
          id: createId(),
          canonical_id: canonical.id,
          alias_text: rawName,
          source: "MANUAL",
          confidence: new Prisma.Decimal("100"),
          confirmed_by: currentUser.id,
          confirmed_at: new Date(),
          created_by: currentUser.id,
        },
      });
      override.resolved_canonical_id = canonical.id;
    } else if (body.action === "override_credit_days") {
      override.credit_days_override = body.credit_days;
      override.credit_days_source = "MANUAL";
      override.reason = body.reason;
    } else if (body.action === "dismiss_parse_error") {
      override.dismissed = true;
      override.reason = body.reason;
    } else {
      override.dismissed = false;
    }

    await tx.snapshots.update({
      where: { id: snapshot.id },
      data: {
        staging_overrides_json: [
          ...latestOverrides,
          override,
        ] as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "staging.patch",
        entity_type: "snapshots",
        entity_id: snapshot.id,
        before: { row_index: rowIndex },
        after: override as Prisma.InputJsonValue,
      },
    });
  });

  // PR C+ — drop the cached alias corpus for this entity if the
  // mutation added a party or an alias. The next staging read will
  // refetch and recache. Skipping invalidation on dismiss/override
  // paths keeps warm hits warm.
  if (
    body.action === "create_canonical" ||
    (body.action === "resolve_alias" && body.create_alias)
  ) {
    invalidateAliasCorpus(targetEntityId);
  }

  const refreshed = await assertSnapshotAccess(snapshotId, currentUser);
  const { rows, gate } = await buildStagingRows(refreshed, currentUser);
  const row = rows.find((item) => item.row_index === rowIndex);
  if (!row) {
    throw new HttpError("row_not_found", 404, "Staging row not found");
  }

  return { row, publish_gate: gate };
}

export interface AutoCanonicalizeInput {
  row_indices?: number[];
}

export interface AutoCanonicalizeResult {
  snapshot_id: string;
  attempted_rows: number;
  canonicals_created: number;
  canonicals_resolved: number;
  skipped_rows: number;
}

export async function autoCreateCanonicals(
  snapshotId: string,
  currentUser: AuthenticatedUser,
  body: AutoCanonicalizeInput,
): Promise<AutoCanonicalizeResult> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "STAGED") {
    throw new HttpError("snapshot_not_staged", 409, "Snapshot is not STAGED");
  }

  if (snapshot.source_hint === "CREDIT_PERIOD") {
    throw new HttpError(
      "invalid_snapshot_source",
      422,
      "Auto canonicalization is only supported for invoice staging snapshots",
    );
  }

  const requested = new Set<number>(body?.row_indices ?? []);
  const { rows } = await buildStagingRows(snapshot, currentUser);
  const candidateRows = rows.filter(
    (row): row is StagingInvoiceRow =>
      "party_name_raw" in row &&
      row.status === "OK" &&
      !row.analyst_overrides.resolved_canonical_id &&
      row.alias_resolution.topMatches.length === 0 &&
      row.party_name_raw.trim().length > 0 &&
      (requested.size === 0 || requested.has(row.row_index)),
  );

  let canonicalsCreated = 0;
  let canonicalsResolved = 0;
  let skipped = 0;

  for (const row of candidateRows) {
    const canonicalName = row.party_name_raw.trim();
    if (!canonicalName) {
      skipped += 1;
      continue;
    }

    const existingCanonical = await getPrisma().parties_canonical.findFirst({
      where: {
        entity_id: snapshot.entity_id,
        OR: [
          { name: canonicalName },
          { party_aliases: { some: { alias_text: canonicalName } } },
        ],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    if (existingCanonical) {
      await patchStagingRow(
        snapshot.id,
        row.row_index,
        {
          action: "resolve_alias",
          canonical_id: existingCanonical.id,
          create_alias: true,
        },
        currentUser,
      );
      canonicalsResolved += 1;
      continue;
    }

    await patchStagingRow(
      snapshot.id,
      row.row_index,
      {
        action: "create_canonical",
        canonical_name: canonicalName,
        alias_text: canonicalName,
        notes: "Auto-created from staging",
      },
      currentUser,
    );
    canonicalsCreated += 1;
  }

  return {
    snapshot_id: snapshot.id,
    attempted_rows: candidateRows.length,
    canonicals_created: canonicalsCreated,
    canonicals_resolved: canonicalsResolved,
    skipped_rows: skipped,
  };
}

export async function bulkMapParties(
  snapshotId: string,
  currentUser: AuthenticatedUser,
): Promise<BulkMapPartiesResult> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "STAGED") {
    throw new HttpError("snapshot_not_staged", 409, "Snapshot is not STAGED");
  }
  if (snapshot.source_hint === "CREDIT_PERIOD") {
    throw new HttpError(
      "invalid_snapshot_source",
      422,
      "Bulk party mapping is not supported for CREDIT_PERIOD snapshots",
    );
  }

  const { rows } = await buildStagingRows(snapshot, currentUser);
  const summary = computePartyMappingSummary(rows);
  const actionableGroups = summary.groups.filter((g) => g.bulk_actionable);

  if (actionableGroups.length === 0) {
    const refreshed = await assertSnapshotAccess(snapshotId, currentUser);
    const { gate } = await buildStagingRows(refreshed, currentUser);
    return {
      snapshot_id: snapshotId,
      rows_mapped: 0,
      parties_created: 0,
      parties_resolved: 0,
      groups_skipped: summary.groups.length,
      publish_gate: gate,
    };
  }

  const now = new Date().toISOString();
  let partiesCreated = 0;
  let partiesResolved = 0;
  let rowsMapped = 0;
  let groupsSkipped = summary.groups.length - actionableGroups.length;

  // Phase 1: resolve canonical IDs + create missing canonicals/aliases OUTSIDE
  // the transaction. This is the N-query loop that previously caused the 5 s
  // interactive-transaction timeout when a snapshot had many unmapped parties.
  // Canonical rows created here are idempotent/reusable if the later snapshot
  // update fails, so there is no correctness regression.
  const groupResolutions = new Map<string, string>();
  const prisma = getPrisma();
  const aliasConfidenceDecimal = new Prisma.Decimal("100");

  for (const group of actionableGroups) {
    if (group.match_status === "EXACT" || group.match_status === "FUZZY_HIGH") {
      if (group.existing_canonical_id) {
        groupResolutions.set(group.normalized_key, group.existing_canonical_id);
        partiesResolved += 1;
      } else {
        groupsSkipped += 1;
      }
      continue;
    }

    // UNMAPPED: check DB for existing party (by name, GSTIN, or alias)
    const existing = await prisma.parties_canonical.findFirst({
      where: {
        entity_id: snapshot.entity_id,
        OR: [
          { name: group.display_name },
          ...(group.gstin ? ([{ gstin: group.gstin }] as const) : []),
          {
            party_aliases: {
              some: { alias_text: { in: group.raw_names } },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (existing) {
      groupResolutions.set(group.normalized_key, existing.id);
      partiesResolved += 1;
    } else {
      const canonical = await prisma.parties_canonical.create({
        data: {
          id: createId(),
          entity_id: snapshot.entity_id,
          name: group.display_name,
          gstin: group.gstin ?? null,
          created_by: currentUser.id,
        },
      });
      await prisma.party_aliases.createMany({
        data: group.raw_names.map((rawName) => ({
          id: createId(),
          canonical_id: canonical.id,
          alias_text: rawName,
          source: "MANUAL",
          confidence: aliasConfidenceDecimal,
          confirmed_by: currentUser.id,
          confirmed_at: new Date(),
          created_by: currentUser.id,
        })),
        skipDuplicates: true,
      });
      groupResolutions.set(group.normalized_key, canonical.id);
      partiesCreated += 1;
    }
  }

  // Phase 2: register FUZZY_HIGH aliases + build override records (in-memory +
  // a few createMany calls — still outside the transaction).
  const newOverrides: StagingOverride[] = [];
  for (const group of actionableGroups) {
    const canonicalId = groupResolutions.get(group.normalized_key);
    if (!canonicalId) continue;

    if (group.match_status === "FUZZY_HIGH") {
      await prisma.party_aliases.createMany({
        data: group.raw_names.map((rawName) => ({
          id: createId(),
          canonical_id: canonicalId,
          alias_text: rawName,
          source: "MANUAL",
          confidence: aliasConfidenceDecimal,
          confirmed_by: currentUser.id,
          confirmed_at: new Date(),
          created_by: currentUser.id,
        })),
        skipDuplicates: true,
      });
    }

    for (const rowIndex of group.row_indices) {
      newOverrides.push({
        row_index: rowIndex,
        action: "resolve_alias",
        created_at: now,
        actor_id: currentUser.id,
        resolved_canonical_id: canonicalId,
      });
      rowsMapped += 1;
    }
  }

  // Phase 3: atomically append overrides to the snapshot JSON. The FOR UPDATE
  // lock serialises concurrent bulk-map calls so no override is lost.
  await dbTransaction(
    "bulkMapParties.snapshot-update",
    async (tx) => {
      const lockedRows = await tx.$queryRawUnsafe<
        { staging_overrides_json: unknown }[]
      >(
        `SELECT staging_overrides_json FROM snapshots WHERE id = $1::uuid FOR UPDATE`,
        snapshot.id,
      );
      const latestOverrides = normalizeOverrides(lockedRows[0]?.staging_overrides_json);

      await tx.snapshots.update({
        where: { id: snapshot.id },
        data: {
          staging_overrides_json: [
            ...latestOverrides,
            ...newOverrides,
          ] as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });

      await tx.audit_log.create({
        data: {
          id: createId(),
          actor_user_id: currentUser.id,
          action: "staging.bulk_map_parties",
          entity_type: "snapshots",
          entity_id: snapshot.id,
          before: {
            prior_overrides: latestOverrides.length,
          } as Prisma.InputJsonValue,
          after: {
            rows_mapped: rowsMapped,
            parties_created: partiesCreated,
            parties_resolved: partiesResolved,
          } as Prisma.InputJsonValue,
        },
      });
    },
    { maxWait: 5_000, timeout: 10_000 },
  );

  invalidateAliasCorpus(snapshot.entity_id);

  const refreshed = await assertSnapshotAccess(snapshotId, currentUser);
  const { gate } = await buildStagingRows(refreshed, currentUser);

  return {
    snapshot_id: snapshotId,
    rows_mapped: rowsMapped,
    parties_created: partiesCreated,
    parties_resolved: partiesResolved,
    groups_skipped: groupsSkipped,
    publish_gate: gate,
  };
}

export async function ackSnapshotWarnings(
  snapshotId: string,
  body: WarningsAckInput,
  currentUser: AuthenticatedUser,
): Promise<WarningsAckResponse> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "STAGED") {
    throw new HttpError("snapshot_not_staged", 409, "Snapshot is not STAGED");
  }

  const parseResult = asParseResult(snapshot.parse_result_json);
  const knownCodes = new Set(
    parseResult.warnings.map((warning) => warning.code),
  );
  for (const code of body.codes) {
    if (!knownCodes.has(code)) {
      throw new HttpError(
        "warning_not_found",
        422,
        `Warning ${code} not found`,
      );
    }
  }

  const acknowledged = [
    ...new Set([
      ...normalizeWarningsAck(snapshot.warnings_acknowledged_json),
      ...body.codes,
    ]),
  ];

  await getPrisma().$transaction(async (tx) => {
    await tx.snapshots.update({
      where: { id: snapshot.id },
      data: {
        warnings_acknowledged_json: acknowledged,
        updated_at: new Date(),
      },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "snapshot.warnings_ack",
        entity_type: "snapshots",
        entity_id: snapshot.id,
        before: normalizeWarningsAck(snapshot.warnings_acknowledged_json),
        after: acknowledged,
      },
    });
  });

  const refreshed = await assertSnapshotAccess(snapshotId, currentUser);
  const { gate } = await buildStagingRows(refreshed, currentUser);
  return { acknowledged, publish_gate: gate };
}

async function resolveCreditDays(params: {
  canonicalId: string;
  invoiceDate: string;
  override: number | null;
  entityDefault: number | null;
}): Promise<{ days: number; source: string }> {
  if (params.override !== null) {
    return { days: params.override, source: "MANUAL" };
  }

  const invoiceDate = parseDateInput(params.invoiceDate);
  const config = await getPrisma().credit_period_config.findFirst({
    where: {
      canonical_id: params.canonicalId,
      valid_from: { lte: invoiceDate ?? undefined },
      OR: [{ valid_to: null }, { valid_to: { gte: invoiceDate ?? undefined } }],
    },
    orderBy: { valid_from: "desc" },
    select: { days: true },
  });

  if (config) {
    return { days: config.days, source: "CONFIG" };
  }

  if (params.entityDefault !== null) {
    return { days: params.entityDefault, source: "DEFAULT" };
  }

  throw new HttpError(
    "credit_days_missing",
    422,
    "No credit period config or entity default is available",
  );
}

type CreditPeriodPublishRow = {
  row: StagingCreditPeriodRow;
  entityId: string;
  canonicalId: string;
};

type CreditPeriodConfigAuditRow = {
  canonical_id: string;
  days: number;
  reason_note: string | null;
  valid_from: Date;
  valid_to: Date | null;
  updated_by: string;
};

function creditPeriodConfigAuditPayload(
  row: CreditPeriodConfigAuditRow,
): Record<string, unknown> {
  return {
    canonical_id: row.canonical_id,
    credit_days: row.days,
    reason_note: row.reason_note,
    valid_from: dateOnly(row.valid_from),
    valid_to: row.valid_to ? dateOnly(row.valid_to) : null,
    updated_by: row.updated_by,
  };
}

async function prepareCreditPeriodPublishRows(
  rows: Array<StagingInvoiceRow | StagingCreditPeriodRow>,
  currentUser: AuthenticatedUser,
): Promise<CreditPeriodPublishRow[]> {
  const creditRows = rows.filter(
    (row): row is StagingCreditPeriodRow =>
      !("party_name_raw" in row) && !row.analyst_overrides.dismissed,
  );
  if (creditRows.length === 0) {
    throw new HttpError(
      "no_publishable_rows",
      422,
      "No publishable credit-period rows",
    );
  }

  const prisma = getPrisma();
  const entityCodes = [...new Set(creditRows.map((row) => row.entity_code))];
  const entities = await prisma.entities.findMany({
    where: { code: { in: entityCodes } },
    select: { id: true, code: true },
  });
  const entityIdByCode = new Map<EntityCode, string>(
    entities.map((entity) => [entity.code as EntityCode, entity.id]),
  );

  for (const code of entityCodes) {
    const entityId = entityIdByCode.get(code);
    if (!entityId) {
      throw new HttpError("entity_missing", 500, `Entity ${code} is missing`);
    }
    await assertAnalystCanAccessEntity(currentUser, entityId);
  }

  const prepared: CreditPeriodPublishRow[] = [];
  const seenCanonicalIds = new Set<string>();
  for (const row of creditRows) {
    const entityId = entityIdByCode.get(row.entity_code);
    if (!entityId) {
      throw new HttpError(
        "entity_missing",
        500,
        `Entity ${row.entity_code} is missing`,
      );
    }

    const overrideId = row.analyst_overrides.resolved_canonical_id;
    const canonical = overrideId
      ? await prisma.parties_canonical.findUnique({
          where: { id: overrideId },
          select: { id: true, entity_id: true },
        })
      : await prisma.parties_canonical.findFirst({
          where: {
            entity_id: entityId,
            OR: [
              { name: row.name },
              { party_aliases: { some: { alias_text: row.name } } },
            ],
          },
          orderBy: { name: "asc" },
          select: { id: true, entity_id: true },
        });

    if (!canonical || canonical.entity_id !== entityId) {
      throw new HttpError(
        "canonical_not_found",
        422,
        `Row ${row.row_index} could not be matched to a ${row.entity_code} canonical party`,
      );
    }

    if (seenCanonicalIds.has(canonical.id)) {
      throw new HttpError(
        "duplicate_credit_period_canonical",
        422,
        `Multiple credit-period rows resolve to the same canonical party at row ${row.row_index}`,
      );
    }

    seenCanonicalIds.add(canonical.id);
    prepared.push({ row, entityId, canonicalId: canonical.id });
  }

  return prepared;
}

async function publishCreditPeriodSnapshot(
  snapshot: SnapshotRow,
  rows: Array<StagingInvoiceRow | StagingCreditPeriodRow>,
  currentUser: AuthenticatedUser,
): Promise<PublishSnapshotResponse> {
  const validFrom = toDate(snapshot.as_of_date);
  if (!validFrom) {
    throw new HttpError(
      "credit_period_valid_from_missing",
      422,
      "Credit-period snapshots need an as_of_date to become config valid_from",
    );
  }
  const validFromDate = parseDateInput(validFrom);
  if (!validFromDate) {
    throw new HttpError(
      "credit_period_valid_from_invalid",
      422,
      "Credit-period snapshot as_of_date is invalid",
    );
  }

  const preparedRows = await prepareCreditPeriodPublishRows(rows, currentUser);
  const now = new Date();
  const publishedAs =
    snapshot.users_snapshots_uploaded_byTousers.email === currentUser.email
      ? "NORMAL"
      : "OVERRIDE";
  let configsWritten = 0;
  const priorValidTo = addDaysUtc(validFrom, -1);

  await getPrisma().$transaction(async (tx) => {
    for (const prepared of preparedRows) {
      const prior = await tx.credit_period_config.findFirst({
        where: {
          canonical_id: prepared.canonicalId,
          valid_to: null,
        },
        orderBy: { valid_from: "desc" },
        select: {
          id: true,
          canonical_id: true,
          days: true,
          reason_note: true,
          valid_from: true,
          valid_to: true,
          updated_by: true,
        },
      });

      if (prior) {
        const before = creditPeriodConfigAuditPayload(prior);
        const priorValidFrom = dateOnly(prior.valid_from);
        if (priorValidFrom > validFrom) {
          throw new HttpError(
            "credit_period_effective_date_conflict",
            409,
            `Existing open credit-period config starts after ${validFrom}`,
          );
        }

        if (priorValidFrom === validFrom) {
          const updated = await tx.credit_period_config.update({
            where: { id: prior.id },
            data: {
              days: prepared.row.credit_days,
              reason_note: prepared.row.reason_note,
              updated_by: currentUser.id,
              updated_at: now,
            },
            select: {
              canonical_id: true,
              days: true,
              reason_note: true,
              valid_from: true,
              valid_to: true,
              updated_by: true,
            },
          });

          await tx.audit_log.create({
            data: {
              id: createId(),
              actor_user_id: currentUser.id,
              action: "credit_period_config.update",
              entity_type: "credit_period_config",
              entity_id: prior.id,
              before: before as Prisma.InputJsonValue,
              after: creditPeriodConfigAuditPayload(
                updated,
              ) as Prisma.InputJsonValue,
            },
          });
          configsWritten += 1;
          continue;
        }

        const closed = await tx.credit_period_config.update({
          where: { id: prior.id },
          data: { valid_to: priorValidTo, updated_at: now },
          select: {
            canonical_id: true,
            days: true,
            reason_note: true,
            valid_from: true,
            valid_to: true,
            updated_by: true,
          },
        });

        await tx.audit_log.create({
          data: {
            id: createId(),
            actor_user_id: currentUser.id,
            action: "credit_period_config.close",
            entity_type: "credit_period_config",
            entity_id: prior.id,
            before: before as Prisma.InputJsonValue,
            after: creditPeriodConfigAuditPayload(
              closed,
            ) as Prisma.InputJsonValue,
          },
        });
      }

      const configId = createId();
      const created = await tx.credit_period_config.create({
        data: {
          id: configId,
          canonical_id: prepared.canonicalId,
          days: prepared.row.credit_days,
          reason_note: prepared.row.reason_note,
          valid_from: validFromDate,
          valid_to: null,
          updated_by: currentUser.id,
          updated_at: now,
        },
        select: {
          canonical_id: true,
          days: true,
          reason_note: true,
          valid_from: true,
          valid_to: true,
          updated_by: true,
        },
      });

      await tx.audit_log.create({
        data: {
          id: createId(),
          actor_user_id: currentUser.id,
          action: "credit_period_config.create",
          entity_type: "credit_period_config",
          entity_id: configId,
          before: Prisma.JsonNull,
          after: creditPeriodConfigAuditPayload(
            created,
          ) as Prisma.InputJsonValue,
        },
      });
      configsWritten += 1;
    }

    await tx.snapshots.update({
      where: { id: snapshot.id },
      data: {
        status: "PUBLISHED",
        published_at: now,
        published_by: currentUser.id,
        published_as: publishedAs,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "snapshot.publish",
        entity_type: "snapshots",
        entity_id: snapshot.id,
        before: { status: snapshot.status },
        after: {
          status: "PUBLISHED",
          published_as: publishedAs,
          credit_period_configs_written: configsWritten,
        },
      },
    });
  });

  return {
    snapshot_id: snapshot.id,
    status: "PUBLISHED",
    published_at: now.toISOString(),
    published_as: publishedAs,
    invoices_upserted: 0,
    invoice_snapshots_created: 0,
    invoices_settled: 0,
    credit_period_configs_written: configsWritten,
  };
}

export async function publishSnapshot(
  snapshotId: string,
  currentUser: AuthenticatedUser,
): Promise<PublishSnapshotResponse> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "STAGED") {
    throw new HttpError("snapshot_not_staged", 409, "Snapshot is not STAGED");
  }

  // Gap 4: daily-cadence guard. Run BEFORE the (expensive) staging-row build
  // so a same-day collision fails fast. Receivables snapshots only — the
  // CREDIT_PERIOD source uses a separate publish path below and is exempt.
  if (
    snapshot.source_hint !== "CREDIT_PERIOD" &&
    snapshot.as_of_date
  ) {
    const sameDayPublished = await getPrisma().snapshots.findFirst({
      where: {
        entity_id: snapshot.entity_id,
        as_of_date: snapshot.as_of_date,
        status: "PUBLISHED",
        source_hint: { not: "CREDIT_PERIOD" },
        id: { not: snapshot.id },
      },
      select: { id: true },
    });
    if (sameDayPublished) {
      throw new HttpError(
        "snapshot_same_day_exists",
        409,
        `A published snapshot for this entity and as-of date already exists (${sameDayPublished.id}). Discard it before publishing a new one, or change the as-of date.`,
      );
    }
  }

  const { rows, gate } = await buildStagingRows(snapshot, currentUser);
  if (!gate.ok) {
    throw new HttpError(
      "publish_gate_blocked",
      422,
      "Publish gate is not satisfied",
    );
  }

  if (snapshot.source_hint === "CREDIT_PERIOD") {
    return publishCreditPeriodSnapshot(snapshot, rows, currentUser);
  }

  const asOfDate = toDate(snapshot.as_of_date);
  if (!asOfDate) {
    throw new HttpError(
      "as_of_date_missing",
      422,
      "Snapshot as_of_date is missing",
    );
  }

  const entity = await getPrisma().entities.findUnique({
    where: { id: snapshot.entity_id },
    select: { default_credit_days: true, base_currency: true },
  });
  if (!entity) {
    throw new HttpError("entity_missing", 500, "Snapshot entity is missing");
  }

  const invoiceRows = rows.filter(
    (row): row is StagingInvoiceRow =>
      "party_name_raw" in row && row.status === "OK",
  );
  if (invoiceRows.length === 0) {
    throw new HttpError(
      "no_publishable_rows",
      422,
      "No publishable invoice rows",
    );
  }

  // PR 9 — preload active LOBs so we can stamp invoices in O(1) at upsert
  // time. Match is case-insensitive against the source `project_id`.
  const activeLobs = await getPrisma().lobs.findMany({
    where: { entity_id: snapshot.entity_id, active: true },
    select: { id: true, code: true },
  });
  const lobByCode = new Map<string, string>(
    activeLobs.map((l) => [l.code.toLowerCase(), l.id]),
  );
  const now = new Date();
  const publishedAs =
    snapshot.users_snapshots_uploaded_byTousers.email === currentUser.email
      ? "NORMAL"
      : "OVERRIDE";
  const touchedInvoiceIds: string[] = [];
  let upserted = 0;
  let snapshotRows = 0;
  let settledCount = 0;
  let cascadeCounts = {
    promises_to_pay: 0,
    dispute_cases: 0,
    collection_tasks: 0,
    exception_tags: 0,
  };
  // PR 3 / Gap 3 counters — total deltas + per-field breakdown.
  let changesDetected = 0;
  const changesByField: Record<string, number> = {};

  // The publish transaction does meaningful work per row (diff capture,
  // upsert, invoice_snapshots write) — over a remote Neon connection that
  // can mean tens of milliseconds per round trip. Default Prisma 5s
  // timeout is far too tight for any real-world batch.
  await getPrisma().$transaction(
    async (tx) => {
    for (const row of invoiceRows) {
      const canonicalId =
        row.analyst_overrides.resolved_canonical_id ??
        row.alias_resolution.topMatches[0]?.canonicalId;
      if (
        !canonicalId ||
        !row.invoice_ref ||
        !row.invoice_date ||
        !row.amount
      ) {
        throw new HttpError(
          "row_not_publishable",
          422,
          `Row ${row.row_index} is missing canonical, invoice, date, or amount`,
        );
      }

      const credit = await resolveCreditDays({
        canonicalId,
        invoiceDate: row.invoice_date,
        override: row.analyst_overrides.credit_days_override,
        entityDefault: entity.default_credit_days,
      });
      const ageing = calculateAgeing({
        invoiceDate: row.invoice_date,
        creditDays: credit.days,
        asOfDate,
      });
      const dueDate = ageing.dueDate;
      const invoiceDate = parseDateInput(row.invoice_date);
      if (!invoiceDate) {
        throw new HttpError(
          "invoice_date_missing",
          422,
          "Invoice date is missing",
        );
      }

      const existing = await tx.invoices.findFirst({
        where: {
          entity_id: snapshot.entity_id,
          canonical_id: canonicalId,
          invoice_ref: row.invoice_ref,
        },
        select: {
          id: true,
          amount: true,
          due_date: true,
          credit_days_applied: true,
          invoice_date: true,
          currency: true,
        },
      });
      const invoiceId = existing?.id ?? createId();
      // PR 9 — auto-tag from Xero project_id. Case-insensitive match
      // against active LOB codes for this entity. No match → lob_id stays
      // null and the analyst can set it manually later.
      const projectId =
        (row.xero_metadata as { project_id?: string | null } | null)?.project_id ??
        null;
      const lobId = projectId
        ? (lobByCode.get(projectId.trim().toLowerCase()) ?? null)
        : null;
      const invoicePayload = {
        entity_id: snapshot.entity_id,
        canonical_id: canonicalId,
        invoice_ref: row.invoice_ref,
        invoice_date: invoiceDate,
        amount: new Prisma.Decimal(row.amount),
        currency: row.source_currency,
        credit_days_applied: credit.days,
        credit_days_source: credit.source,
        due_date: dueDate,
        status: "OPEN",
        lob_id: lobId,
        raw_row_json: row.raw_row_json as Prisma.InputJsonValue,
        xero_metadata: row.xero_metadata as Prisma.InputJsonValue,
        updated_at: now,
      };

      if (existing) {
        // PR 3 / Gap 3 — capture the delta BEFORE we overwrite the row, so
        // analysts can see exactly what shifted vs. the previously-published
        // invoice. Write one invoice_changes row per changed field.
        const deltas = diffInvoice(existing, invoicePayload);
        if (deltas.length > 0) {
          await tx.invoice_changes.createMany({
            data: deltas.map((d) => ({
              id: createId(),
              invoice_id: invoiceId,
              snapshot_id: snapshot.id,
              field: d.field,
              before_value: d.before as Prisma.InputJsonValue,
              after_value: d.after as Prisma.InputJsonValue,
            })),
          });
          changesDetected += deltas.length;
          for (const d of deltas) {
            changesByField[d.field] = (changesByField[d.field] ?? 0) + 1;
          }
        }
        await tx.invoices.update({
          where: { id: invoiceId },
          data: {
            ...invoicePayload,
            settled_snapshot_id: null,
          },
        });
      } else {
        await tx.invoices.create({
          data: {
            id: invoiceId,
            ...invoicePayload,
            first_seen_snapshot_id: snapshot.id,
          },
        });
      }

      await tx.invoice_snapshots.create({
        data: {
          snapshot_id: snapshot.id,
          invoice_id: invoiceId,
          as_of_date: parseDateInput(asOfDate) ?? now,
          outstanding_amount: new Prisma.Decimal(row.amount),
          overdue_days: ageing.overdueDays,
          bucket: ageing.bucket,
        },
      });

      touchedInvoiceIds.push(invoiceId);
      upserted += 1;
      snapshotRows += 1;
    }

    // Capture which invoice IDs are about to be settled so the cascade
    // can resolve their attached operational objects (PR 2 / Gap 2).
    const aboutToSettle = await tx.invoices.findMany({
      where: {
        entity_id: snapshot.entity_id,
        status: "OPEN",
        id: { notIn: touchedInvoiceIds },
      },
      select: { id: true },
    });
    const settledInvoiceIds = aboutToSettle.map((i) => i.id);

    const settled = await tx.invoices.updateMany({
      where: {
        entity_id: snapshot.entity_id,
        status: "OPEN",
        id: { notIn: touchedInvoiceIds },
      },
      data: {
        status: "SETTLED",
        settled_snapshot_id: snapshot.id,
        updated_at: now,
      },
    });
    settledCount = settled.count;

    // PR 2 / Gap 2 — Option A: cascade-resolve operational objects on
    // freshly settled invoices. Records counts in the publish audit row.
    cascadeCounts = await autoResolveCascadeOnSettle(tx, {
      snapshotId: snapshot.id,
      settledInvoiceIds,
      now,
    });

    // PR 8b — opportunistic save on first publish. If no saved mapping
    // exists yet for (entity, source) and we captured one during parse,
    // persist it as the baseline. Subsequent publishes leave the saved
    // mapping alone — analysts must explicitly "Save as default" to
    // change it (PR 8a UI). This gives drift detection something to
    // compare against without forcing an extra click on first use.
    if (snapshot.column_mapping_json) {
      const existingMapping = await tx.column_mappings.findUnique({
        where: {
          entity_id_source_hint: {
            entity_id: snapshot.entity_id,
            source_hint: snapshot.source_hint,
          },
        },
        select: { id: true },
      });
      if (!existingMapping) {
        await tx.column_mappings.create({
          data: {
            id: createId(),
            entity_id: snapshot.entity_id,
            source_hint: snapshot.source_hint,
            mapping_json: snapshot.column_mapping_json as Prisma.InputJsonValue,
            created_by: currentUser.id,
            created_at: now,
            updated_at: now,
          },
        });
      }
    }

    await tx.snapshots.update({
      where: { id: snapshot.id },
      data: {
        status: "PUBLISHED",
        published_at: now,
        published_by: currentUser.id,
        published_as: publishedAs,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "snapshot.publish",
        entity_type: "snapshots",
        entity_id: snapshot.id,
        before: { status: snapshot.status },
        after: {
          status: "PUBLISHED",
          published_as: publishedAs,
          invoices_upserted: upserted,
          invoice_snapshots_created: snapshotRows,
          invoices_settled: settledCount,
          auto_resolved: { ...cascadeCounts },
          changes_detected: {
            total: changesDetected,
            by_field: { ...changesByField },
          },
        },
      },
    });

    // Generate suggested collection tasks (one audit row covers the whole batch)
    const suggestResult = await generateSuggestedTasks(tx, {
      snapshotId: snapshot.id,
      entityId: snapshot.entity_id,
      asOfDate,
      publishedBy: currentUser.id,
    });

    // Always write audit row — idempotent re-publish needs zero-count record too
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "collection_task.suggest_batch",
        entity_type: "snapshots",
        entity_id: snapshot.id,
        after: {
          snapshot_id: snapshot.id,
          total_count: suggestResult.total,
          by_reason_code: suggestResult.by_reason_code,
        },
      },
    });
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  return {
    snapshot_id: snapshot.id,
    status: "PUBLISHED",
    published_at: now.toISOString(),
    published_as: publishedAs,
    invoices_upserted: upserted,
    invoice_snapshots_created: snapshotRows,
    invoices_settled: settledCount,
    auto_resolved: cascadeCounts,
    changes_detected: {
      total: changesDetected,
      by_field: changesByField,
    },
  };
}

export async function discardSnapshot(
  snapshotId: string,
  body: DiscardSnapshotInput,
  currentUser: AuthenticatedUser,
): Promise<DiscardSnapshotResponse> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);

  if (snapshot.status !== "STAGED") {
    throw new HttpError(
      "snapshot_not_staged",
      409,
      "Only STAGED snapshots can be discarded",
    );
  }

  const now = new Date();
  await getPrisma().$transaction(async (tx) => {
    await tx.snapshots.update({
      where: { id: snapshotId },
      data: {
        status: "DISCARDED",
        discarded_at: now,
        discarded_by: currentUser.id,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "snapshot.discard",
        entity_type: "snapshots",
        entity_id: snapshotId,
        before: { status: snapshot.status },
        after: {
          status: "DISCARDED",
          reason: body.reason ?? null,
          discarded_by: currentUser.id,
        },
      },
    });
  });

  return {
    snapshot_id: snapshotId,
    status: "DISCARDED",
    discarded_at: now.toISOString(),
    discarded_by: { id: currentUser.id, email: currentUser.email },
    reason: body.reason ?? null,
  };
}

export async function getOrComputeReconciliation(
  snapshotId: string,
  currentUser: AuthenticatedUser,
): Promise<ReconciliationResponse> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "PUBLISHED") {
    throw new HttpError(
      "snapshot_not_published",
      409,
      "Reconciliation is only available for PUBLISHED snapshots",
    );
  }

  const [entry, computed] = await Promise.all([
    getPrisma().reconciliation_entries.findUnique({
      where: { snapshot_id: snapshotId },
      include: { users: { select: { id: true, email: true } } },
    }),
    computeReconciliationParts(snapshot),
  ]);

  return {
    snapshot_id: snapshotId,
    snapshot_as_of_date: toDate(snapshot.as_of_date),
    entity_code: snapshot.entities.code as "IND" | "UAE",
    dashboard_ar: computed.dashboardAr,
    exception_bucket_total: computed.exceptionBucketTotal,
    exception_bucket_breakdown: computed.exceptionBucketBreakdown,
    tally_xero_closing_ar: entry
      ? formatDecimal(entry.tally_xero_closing_ar)
      : null,
    delta: entry ? formatDecimal(entry.delta) : null,
    status: (entry?.status ??
      "UNRECONCILED") as ReconciliationResponse["status"],
    entered_by: entry?.users
      ? { id: entry.users.id, email: entry.users.email }
      : null,
    entered_at: entry?.entered_at ? entry.entered_at.toISOString() : null,
    notes: entry?.notes ?? null,
  };
}

export async function upsertReconciliation(
  snapshotId: string,
  body: ReconciliationUpsertInput,
  currentUser: AuthenticatedUser,
): Promise<ReconciliationResponse> {
  const snapshot = await assertSnapshotAccess(snapshotId, currentUser);
  if (snapshot.status !== "PUBLISHED") {
    throw new HttpError(
      "snapshot_not_published",
      409,
      "Can only reconcile PUBLISHED snapshots",
    );
  }

  const existing = await getPrisma().reconciliation_entries.findUnique({
    where: { snapshot_id: snapshotId },
  });
  const computed = await computeReconciliationParts(snapshot);
  const tallyAr = parseTallyAr(body.tally_xero_closing_ar);
  const deltaCents =
    parseToCents(computed.dashboardAr) +
    parseToCents(computed.exceptionBucketTotal) -
    parseToCents(tallyAr);
  const delta = formatFromCents(deltaCents);
  const status = reconciliationStatus(deltaCents);
  const now = new Date();

  await getPrisma().$transaction(async (tx) => {
    await tx.reconciliation_entries.upsert({
      where: { snapshot_id: snapshotId },
      update: {
        dashboard_ar: new Prisma.Decimal(computed.dashboardAr),
        exception_bucket_total: new Prisma.Decimal(
          computed.exceptionBucketTotal,
        ),
        exception_bucket_breakdown: computed.exceptionBucketBreakdown,
        tally_xero_closing_ar: new Prisma.Decimal(tallyAr),
        delta: new Prisma.Decimal(delta),
        status,
        entered_by: currentUser.id,
        entered_at: now,
        notes: body.notes ?? null,
      },
      create: {
        id: createId(),
        snapshot_id: snapshotId,
        dashboard_ar: new Prisma.Decimal(computed.dashboardAr),
        exception_bucket_total: new Prisma.Decimal(
          computed.exceptionBucketTotal,
        ),
        exception_bucket_breakdown: computed.exceptionBucketBreakdown,
        tally_xero_closing_ar: new Prisma.Decimal(tallyAr),
        delta: new Prisma.Decimal(delta),
        status,
        entered_by: currentUser.id,
        entered_at: now,
        notes: body.notes ?? null,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: "reconciliation.upsert",
        entity_type: "reconciliation_entries",
        entity_id: snapshotId,
        before: existing
          ? {
              tally_xero_closing_ar: formatDecimal(
                existing.tally_xero_closing_ar,
              ),
              delta: formatDecimal(existing.delta),
              status: existing.status,
            }
          : Prisma.JsonNull,
        after: {
          snapshot_id: snapshotId,
          tally_xero_closing_ar: tallyAr,
          delta,
          status,
          dashboard_ar: computed.dashboardAr,
          exception_bucket_total: computed.exceptionBucketTotal,
        },
      },
    });
  });

  return getOrComputeReconciliation(snapshotId, currentUser);
}
