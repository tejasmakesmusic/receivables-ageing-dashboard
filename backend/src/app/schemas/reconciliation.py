"""Reconciliation schemas — GET/POST /snapshots/:id/reconciliation (M6 A6)."""

from __future__ import annotations

from datetime import date, datetime  # noqa: TCH003
from decimal import Decimal  # noqa: TCH003
from typing import Literal
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict


class UserRef(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    email: str


class ReconciliationResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    snapshot_id: UUID
    snapshot_as_of_date: date
    entity_code: Literal["IND", "UAE"]
    dashboard_ar: Decimal
    exception_bucket_total: Decimal
    exception_bucket_breakdown: dict[str, Decimal]
    tally_xero_closing_ar: Decimal | None
    delta: Decimal | None
    status: Literal["MATCHED", "MISMATCHED", "UNRECONCILED"]
    entered_by: UserRef | None
    entered_at: datetime | None
    notes: str | None


class ReconciliationCreateRequest(BaseModel):
    tally_xero_closing_ar: Decimal
    notes: str | None = None
