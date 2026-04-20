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

export interface ReconciliationSummary {
  status: "MATCHED" | "MISMATCHED" | "UNRECONCILED";
  delta: string | null;
  tally_xero_closing_ar: string | null;
  dashboard_ar: string;
  updated_at: string | null;
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
  reconciliation: ReconciliationSummary | null;
}

export interface SnapshotListResponse {
  items: SnapshotListRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface MaterialChangeFlag {
  invoice_id: string;
  invoice_ref: string;
  canonical_name: string;
  /** Decimal serialised as string on the wire */
  prior_amount: string;
  /** Decimal serialised as string on the wire */
  new_amount: string;
  /** Decimal serialised as string on the wire */
  delta_pct: string;
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
  material_change_flags: MaterialChangeFlag[] | null;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export type AliasConfidence = "EXACT" | "FUZZY_HIGH" | "FUZZY_LOW" | "UNMAPPED";

export interface AliasCandidate {
  canonical_id: string;
  canonical_name: string;
  ratio: number;
  matched_on: "CANONICAL_NAME" | "ALIAS";
  matched_text: string;
  is_exact: boolean;
}

export interface AliasResolution {
  resolution_state: AliasConfidence;
  raw_name: string;
  top_matches: AliasCandidate[];
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

export interface BulkCreateCanonicalsResponse {
  distinct_unmapped_names: number;
  created_canonicals: number;
  created_aliases: number;
  skipped_existing_canonical: number;
  skipped_existing_alias: number;
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
  /** ISO date string — only populated for entity=ALL */
  fx_rate_effective_from: string | null;
  fx_rate_from_ccy: "AED" | null;
  fx_rate_to_ccy: "INR" | null;
}

export interface TopPartyRow {
  canonical_id: string;
  canonical_name: string;
  outstanding: string;
  overdue_bucket: string;
  active_exception_count: number;
  tally_overdue_days_max: number | null;
  last_follow_up_date: string | null;
  last_follow_up_channel: string | null;
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

export interface DashboardTrendRow {
  week_start: string;
  /** Decimal serialised as string on the wire */
  total_outstanding: string;
  /** Decimal serialised as string on the wire */
  ninety_plus: string;
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
  trend_weekly: DashboardTrendRow[];
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export type ExcludeReason = "LEGAL_HOLD" | "NEGOTIATION" | "AGREED_WRITE_OFF" | "OTHER";

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
  last_follow_up_date: string | null;
  last_follow_up_channel: string | null;
  // Exclusion fields (Task A.1)
  excluded_at: string | null;
  excluded_reason: ExcludeReason | null;
  excluded_reason_note: string | null;
  excluded_by_email: string | null;
  // Stale flag (D12 / Task A.5)
  is_stale: boolean;
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
// Config — default-CP report (A.4 spec §13 #5)
// ---------------------------------------------------------------------------

export interface DefaultCpPartyReportRow {
  canonical_id: string;
  canonical_name: string;
  /** Decimal serialised as string */
  total_outstanding: string;
  n_open_invoices: number;
}

export interface DefaultCpReportResponse {
  entity_code: EntityCode;
  as_of_date: string;
  snapshot_id: string;
  currency_display: string;
  total_parties_on_default: number;
  parties: DefaultCpPartyReportRow[];
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
  /** Not in the backend schema — derived on the frontend from the known seed set. */
  pre_seeded?: boolean;
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
// Admin — email rules (Task A.3)
// ---------------------------------------------------------------------------

export type EntityFilterLiteral = "IND" | "UAE" | "ALL";

export interface EmailRuleRow {
  id: string;
  rule_type: string;
  recipients_json: string[];
  cron_schedule: string | null;
  is_active: boolean;
  entity_filter: EntityFilterLiteral | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface EmailRuleListResponse {
  items: EmailRuleRow[];
  total: number;
}

export interface EmailRulePatchRequest {
  recipients_json?: string[];
  cron_schedule?: string;
  is_active?: boolean;
  entity_filter?: EntityFilterLiteral;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Party drill-down (D2)
// ---------------------------------------------------------------------------

export interface PartyInvoiceRow {
  invoice_id: string;
  invoice_ref: string;
  invoice_date: string;
  amount: string;
  currency: string;
  due_date: string;
  credit_days_applied: number;
  credit_days_source: string;
  status: string;
  overdue_days: number | null;
  bucket: string | null;
  outstanding_amount: string | null;
  active_exception_count: number;
}

export interface PartyResponse {
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  total_outstanding: string;
  currency_display: string;
  active_invoice_count: number;
  active_exception_count: number;
  invoices: PartyInvoiceRow[];
}

// ---------------------------------------------------------------------------
// Invoice drill-down (D3)
// ---------------------------------------------------------------------------

export interface ExceptionTagRow {
  id: string;
  bucket_type_code: string;
  bucket_type_name: string;
  reason: string;
  tagged_at: string;
  tagged_by_email: string;
  status: string;
  expected_resolution_date: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface InvoiceSnapshotHistoryRow {
  as_of_date: string;
  snapshot_id: string;
  outstanding_amount: string;
  overdue_days: number;
  bucket: string;
}

export interface InvoiceDetailResponse {
  invoice_id: string;
  invoice_ref: string;
  invoice_date: string;
  amount: string;
  currency: string;
  due_date: string;
  credit_days_applied: number;
  credit_days_source: string;
  status: string;
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  first_seen_snapshot_id: string;
  settled_snapshot_id: string | null;
  exception_tags: ExceptionTagRow[];
  snapshot_history: InvoiceSnapshotHistoryRow[];
}

// ---------------------------------------------------------------------------
// Follow-ups (S6)
// ---------------------------------------------------------------------------

export type FollowUpChannel = "EMAIL" | "CALL" | "WHATSAPP" | "MEETING";

export interface FollowUpCreateRequest {
  date: string; // ISO date YYYY-MM-DD
  channel: FollowUpChannel;
  contact_person?: string | null;
  next_action_date?: string | null;
  notes?: string | null;
  /** Exactly one of invoice_id or canonical_id must be provided. */
  invoice_id?: string | null;
  canonical_id?: string | null;
}

export interface FollowUpUpdateRequest {
  date?: string | null;
  channel?: FollowUpChannel | null;
  contact_person?: string | null;
  next_action_date?: string | null;
  notes?: string | null;
}

export interface FollowUpRow {
  id: string;
  invoice_id: string | null;
  canonical_id: string;
  date: string;
  channel: FollowUpChannel;
  contact_person: string | null;
  next_action_date: string | null;
  notes: string | null;
  logged_by: string;
  logged_by_email: string;
  logged_at: string;
  canonical_name: string;
  invoice_ref: string | null;
}

export interface FollowUpListResponse {
  items: FollowUpRow[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// CP diff (Task 15 — GET /snapshots/:id/cp-diff)
// ---------------------------------------------------------------------------

export interface CpDiffEntry {
  canonical_name: string;
  entity_code: string;
  days: number;
  reason_note: string | null;
  /** Populated for SUPERSEDED and UNCHANGED rows. */
  prior_days: number | null;
  prior_reason_note: string | null;
}

export interface CpDiffResponse {
  snapshot_id: string;
  added: CpDiffEntry[];
  superseded: CpDiffEntry[];
  unchanged: CpDiffEntry[];
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
