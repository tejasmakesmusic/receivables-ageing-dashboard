export type DashboardEntity = "IND" | "UAE" | "ALL";

export type DashboardBucket =
  | "NOT_DUE"
  | "DUE_TODAY"
  | "0_30"
  | "31_60"
  | "61_90"
  | "90_PLUS";

export type DashboardStatus = "PUBLISHED" | "STAGED" | "DISCARDED" | string;

export interface DashboardKPIs {
  total_outstanding: number;
  pct_overdue: number;
  parties_with_90plus_count: number;
  last_snapshot_date: string;
  fx_rate_used: number | null;
}

export interface DashboardTopParty {
  canonical_id: string;
  canonical_name: string;
  outstanding: number;
  overdue_bucket: DashboardBucket;
  active_exception_count: number;
}

export interface DashboardRecentException {
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
  entity: DashboardEntity;
  as_of_date: string;
  snapshot_id: string;
  snapshot_status: DashboardStatus;
  currency_display: "INR" | "AED";
  kpis: DashboardKPIs;
  ageing_buckets: Record<DashboardBucket, number>;
  top_parties: DashboardTopParty[];
  recent_exceptions: DashboardRecentException[];
  parties_on_default_credit_period_count: number;
}

export interface DashboardRequest {
  entity: DashboardEntity;
  as_of: string;
}

export type DashboardErrorCode =
  | "INVALID_ENTITY"
  | "INVALID_AS_OF"
  | "SNAPSHOT_NOT_FOUND"
  | "FX_RATE_MISSING";

export type DashboardErrorDetail =
  | { code: DashboardErrorCode; message: string }
  | {
      code: DashboardErrorCode;
      message: string;
      from_ccy: string;
      to_ccy: string;
    };

export class DashboardError extends Error {
  public status: number;
  public detail: DashboardErrorDetail;

  constructor(status: number, detail: DashboardErrorDetail) {
    super(detail.message);
    this.status = status;
    this.detail = detail;
  }
}
