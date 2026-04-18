"""Party drill-down schemas — GET /parties/:canonical_id (M4 D2)."""

from __future__ import annotations

from datetime import date  # noqa: TCH003
from decimal import Decimal  # noqa: TCH003
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict


class PartyInvoiceRow(BaseModel):
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
    overdue_days: int | None
    bucket: str | None
    outstanding_amount: Decimal | None
    active_exception_count: int


class PartyResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    canonical_id: UUID
    canonical_name: str
    entity_code: str
    total_outstanding: Decimal
    currency_display: str
    active_invoice_count: int
    active_exception_count: int
    invoices: list[PartyInvoiceRow]
