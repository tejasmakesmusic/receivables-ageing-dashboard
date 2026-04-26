"""Dashboard API schemas — GET /dashboard (M4 D1).

All monetary values are in the entity's native currency (INR for IND/ALL,
AED for UAE). For entity=ALL, AED values are converted to INR using the
FX rate pinned by each invoice's invoice_date (spec §7).
"""

from __future__ import annotations

from datetime import date, datetime  # noqa: TCH003
from decimal import Decimal  # noqa: TCH003
from typing import Literal
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict


class DashboardKPIs(BaseModel):
    model_config = ConfigDict(frozen=True)

    total_outstanding: Decimal
    pct_overdue: Decimal  # 0.0–100.0
    parties_with_90plus_count: int
    last_snapshot_date: date
    # Only populated for entity=ALL (consolidated FX view)
    fx_rate_used: Decimal | None = None
    # Serialised as string on the wire (spec §7 tooltip requirement)
    fx_rate_effective_from: date | None = None
    fx_rate_from_ccy: Literal["AED"] | None = None
    fx_rate_to_ccy: Literal["INR"] | None = None


class TopPartyRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    canonical_id: UUID
    canonical_name: str
    outstanding: Decimal
    overdue_bucket: str  # the worst (most overdue) bucket for this party
    active_exception_count: int
    tally_overdue_days_max: int | None = (
        None  # max Tally overdue_days across OPEN invoices (spec §13 #4)
    )
    last_follow_up_date: date | None = None
    last_follow_up_channel: str | None = None


class RecentExceptionRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    exception_id: UUID
    invoice_id: UUID
    invoice_ref: str
    canonical_name: str
    bucket_type_code: str
    bucket_type_name: str
    tagged_at: datetime
    expected_resolution_date: date | None


class UserRef(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    email: str


class DashboardTrendRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    week_start: date
    total_outstanding: Decimal
    ninety_plus: Decimal


class DashboardResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    entity: Literal["IND", "UAE", "ALL"]
    as_of_date: date
    snapshot_id: UUID
    snapshot_status: str
    currency_display: Literal["INR", "AED"]
    kpis: DashboardKPIs
    ageing_buckets: dict[str, Decimal]  # NOT_DUE, 0_30, 31_60, 61_90, 90_PLUS
    top_parties: list[TopPartyRow]
    recent_exceptions: list[RecentExceptionRow]
    parties_on_default_credit_period_count: int
    trend_weekly: list[DashboardTrendRow] = []
