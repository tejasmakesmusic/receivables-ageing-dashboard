"""Invoice schemas — GET /invoices/:id and GET /invoices (M4/M5)."""

from __future__ import annotations

from datetime import date, datetime  # noqa: TCH003
from decimal import Decimal  # noqa: TCH003
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict


class ExceptionTagRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    bucket_type_code: str
    bucket_type_name: str
    reason: str
    tagged_at: datetime
    tagged_by_email: str
    status: str
    expected_resolution_date: date | None
    resolved_at: datetime | None
    resolution_note: str | None


class InvoiceSnapshotHistoryRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    as_of_date: date
    snapshot_id: UUID
    outstanding_amount: Decimal
    overdue_days: int
    bucket: str


class InvoiceDetailResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    invoice_id: UUID
    invoice_ref: str
    invoice_date: date
    amount: Decimal
    currency: str
    due_date: date
    credit_days_applied: int
    credit_days_source: str
    status: str
    canonical_id: UUID
    canonical_name: str
    entity_code: str
    first_seen_snapshot_id: UUID
    settled_snapshot_id: UUID | None
    exception_tags: list[ExceptionTagRow]
    snapshot_history: list[InvoiceSnapshotHistoryRow]


class InvoiceListRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    invoice_id: UUID
    invoice_ref: str
    invoice_date: date
    amount: Decimal
    currency: str
    due_date: date
    credit_days_applied: int
    status: str
    canonical_id: UUID
    canonical_name: str
    entity_code: str
    overdue_days: int | None
    bucket: str | None
    active_exception_count: int


class InvoiceListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[InvoiceListRow]
    total: int
    page: int
    page_size: int
