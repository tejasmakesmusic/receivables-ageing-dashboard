/**
 * TypeScript interfaces mirroring backend Pydantic schemas.
 * Names match the schemas/ module naming per spec §10.
 */

// ---------------------------------------------------------------------------
// Auth / user
// ---------------------------------------------------------------------------

export type Role = "ANALYST" | "CFO" | "ADMIN" | "PENDING";
export type EntityCode = "IND" | "UAE";
export type EntityOrAll = "IND" | "UAE" | "ALL";
export type AgeingBucket = "NOT_DUE" | "0_30" | "31_60" | "61_90" | "90_PLUS";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  entity_id_scope: string | null;
}

// ---------------------------------------------------------------------------
// Snapshot / upload
// ---------------------------------------------------------------------------

export type SnapshotStatus = "STAGED" | "PUBLISHED" | "DISCARDED";
export type SourceHint = "TALLY" | "XERO" | "CREDIT_PERIOD";

export interface WarningItem {
  code: string;
  message: string;
  detail: Record<string, unknown> | null;
}

export interface ParseSummary {
  invoices_parsed: number;
  credit_periods_parsed: number;
  parse_error_count: number;
  warnings: WarningItem[];
}

export interface SnapshotCreateResponse {
  snapshot_id: string;
  status: "STAGED";
  source_hint: SourceHint;
  as_of_date: string | null;
  file_sha256: string;
  parse_summary: ParseSummary;
}

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
}

export interface SnapshotListResponse {
  items: SnapshotListRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface SnapshotDetailResponse {
  id: string;
  entity_code: string;
  source_hint: string;
  status: string;
  as_of_date: string | null;
  uploaded_at: string;
  uploaded_by_email: string;
  published_at: string | null;
  published_by_email: string | null;
  published_as: string | null;
  row_count: number | null;
  total_outstanding: string | null;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export type AliasConfidence = "EXACT" | "FUZZY_HIGH" | "FUZZY_LOW" | "UNMAPPED";

export interface AliasCandidate {
  canonical_id: string;
  canonical_name: string;
  score: number;
  source: string;
}

export interface AliasResolution {
  confidence: AliasConfidence;
  matched_canonical_id: string | null;
  matched_canonical_name: string | null;
  score: number | null;
  candidates: AliasCandidate[];
}

export interface AnalystOverridesInvoice {
  resolved_canonical_id: string | null;
  credit_days_override: number | null;
  credit_days_source: "CONFIG" | "DEFAULT" | "MANUAL" | null;
  dismissed: boolean;
}

export interface AnalystOverridesCreditPeriod {
  resolved_canonical_id: string | null;
  dismissed: boolean;
}

export interface StagingInvoiceRow {
  row_index: number;
  status: "OK" | "PARSE_ERROR";
  party_name_raw: string;
  invoice_ref: string | null;
  invoice_date: string | null;
  amount: string | null;
  source_currency: "INR" | "AED";
  parse_error_reason: string | null;
  alias_resolution: AliasResolution;
  analyst_overrides: AnalystOverridesInvoice;
  xero_metadata: Record<string, unknown> | null;
  raw_row_json: Record<string, unknown>;
}

export interface StagingCreditPeriodRow {
  row_index: number;
  entity_code: EntityCode;
  name: string;
  credit_days: number;
  reason_note: string | null;
  analyst_overrides: AnalystOverridesCreditPeriod;
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
  parse_errors_unresolved_count: number;
  warnings_unacknowledged: string[];
  role_permits_publish: boolean;
}

export interface StagingViewResponse {
  snapshot_id: string;
  snapshot_status: SnapshotStatus;
  entity_code: EntityCode;
  as_of_date: string | null;
  source_hint: SourceHint;
  file_sha256: string;
  uploaded_by: string;
  uploaded_at: string;
  totals: StagingTotals;
  publish_gate: PublishGate;
  rows: StagingInvoiceRow[] | StagingCreditPeriodRow[];
  pagination: { offset: number; limit: number; total: number };
}

export interface StagingPatchResponse {
  row: StagingInvoiceRow | StagingCreditPeriodRow;
  publish_gate: PublishGate;
}

export interface WarningsAckResponse {
  acknowledged: string[];
  publish_gate: PublishGate;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardKPIs {
  total_outstanding: string;
  pct_overdue: string;
  parties_with_90plus_count: number;
  last_snapshot_date: string;
  fx_rate_used: string | null;
}

export interface TopPartyRow {
  canonical_id: string;
  canonical_name: string;
  outstanding: string;
  overdue_bucket: string;
  active_exception_count: number;
}

export interface RecentExceptionRow {
  exception_id: string;
  invoice_id: string;
  invoice_ref: string;
  canonical_name: string;
  bucket_type_code: string;
  bucket_type_name: string;
  tagged_at: string;
  expected_resolution_date: string | null;
}

export interface DashboardResponse {
  entity: EntityOrAll;
  as_of_date: string;
  snapshot_id: string;
  snapshot_status: string;
  currency_display: "INR" | "AED";
  kpis: DashboardKPIs;
  ageing_buckets: Record<string, string>;
  top_parties: TopPartyRow[];
  recent_exceptions: RecentExceptionRow[];
  parties_on_default_credit_period_count: number;
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export interface ExceptionListRow {
  id: string;
  invoice_id: string;
  invoice_ref: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  bucket_type_code: string;
  bucket_type_name: string;
  reason: string;
  status: string;
  tagged_at: string;
  tagged_by_email: string;
  expected_resolution_date: string | null;
  resolved_at: string | null;
}

export interface ExceptionListResponse {
  items: ExceptionListRow[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Config — credit periods
// ---------------------------------------------------------------------------

export interface CreditPeriodRow {
  id: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: EntityCode;
  credit_days: number;
  reason_note: string | null;
  valid_from: string;
  valid_to: string | null;
  created_by: string;
  created_at: string;
}

export interface CreditPeriodListResponse {
  items: CreditPeriodRow[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

// ---------------------------------------------------------------------------
// Config — aliases
// ---------------------------------------------------------------------------

export interface AliasRow {
  id: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: EntityCode;
  alias_text: string;
  source: "TALLY" | "XERO" | "MANUAL";
  created_by: string;
  created_at: string;
}

export interface AliasListResponse {
  items: AliasRow[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

// ---------------------------------------------------------------------------
// Admin — exception buckets
// ---------------------------------------------------------------------------

export interface ExceptionBucketRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  created_at: string;
}

export interface ExceptionBucketListResponse {
  items: ExceptionBucketRow[];
  total: number;
}

// ---------------------------------------------------------------------------
// Admin — FX rates
// ---------------------------------------------------------------------------

export interface FxRateRow {
  id: string;
  from_ccy: string;
  to_ccy: string;
  rate: string;
  valid_from: string;
  source: string;
  created_at: string;
  created_by_email: string | null;
}

export interface FxRateListResponse {
  items: FxRateRow[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Admin — audit log
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLogRow[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Admin — email outbox
// ---------------------------------------------------------------------------

export interface EmailOutboxRow {
  id: string;
  rule_type: string;
  snapshot_id: string | null;
  subject: string;
  status: string;
  attempts: number;
  enqueued_at: string;
  sent_at: string | null;
  last_error: string | null;
}

export interface EmailOutboxListResponse {
  items: EmailOutboxRow[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconciliationResponse {
  snapshot_id: string;
  snapshot_as_of_date: string;
  entity_code: EntityCode;
  dashboard_ar: string;
  exception_bucket_total: string;
  exception_bucket_breakdown: Record<string, string>;
  tally_xero_closing_ar: string | null;
  delta: string | null;
  status: "MATCHED" | "MISMATCHED" | "UNRECONCILED";
  entered_by: { id: string; email: string } | null;
  entered_at: string | null;
  notes: string | null;
}
