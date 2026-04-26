"""Exception tag schemas — POST/PATCH /exceptions and GET /exceptions (M5)."""

from __future__ import annotations

from datetime import date, datetime  # noqa: TCH003
from decimal import Decimal  # noqa: TCH003
from typing import Literal
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict, field_validator


class ExceptionCreateRequest(BaseModel):
    bucket_type_code: str
    reason: str
    expected_resolution_date: date | None = None
    note: str | None = None

    @field_validator("reason")
    @classmethod
    def reason_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("reason must not be empty")
        return v

    @field_validator("bucket_type_code")
    @classmethod
    def code_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("bucket_type_code must not be empty")
        return v


class ExceptionCreateResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    invoice_id: UUID
    bucket_type_code: str
    bucket_type_name: str
    reason: str
    tagged_at: datetime
    tagged_by_email: str
    status: str
    expected_resolution_date: date | None
    note: str | None


class ExceptionUpdateRequest(BaseModel):
    action: Literal[
        "RESOLVE",
        "UPDATE_NOTE",
        "UPDATE_EXPECTED_RESOLUTION_DATE",
        "EDIT_HEADLINE",
    ]
    resolution_note: str | None = None
    note: str | None = None
    expected_resolution_date: date | None = None
    reason: str | None = None


class ExceptionUpdateResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    invoice_id: UUID
    status: str
    action_applied: str
    resolved_at: datetime | None = None
    resolution_note: str | None = None
    note: str | None = None
    expected_resolution_date: date | None = None


class ExceptionListRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    invoice_id: UUID
    invoice_ref: str
    canonical_id: UUID
    canonical_name: str
    entity_code: str
    bucket_type_code: str
    bucket_type_name: str
    reason: str
    status: str
    tagged_at: datetime
    tagged_by_email: str
    expected_resolution_date: date | None
    resolved_at: datetime | None
    last_follow_up_date: date | None = None
    last_follow_up_channel: str | None = None
    outstanding_amount: Decimal | None = None
    notes_count: int = 0


class ExceptionListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[ExceptionListRow]
    total: int
    page: int
    page_size: int
