"""Admin schemas — exception buckets, audit log, email outbox (M6)."""

from __future__ import annotations

from datetime import datetime  # noqa: TCH003
from typing import Any
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict, field_validator

# ---------------------------------------------------------------------------
# Exception bucket types (A3)
# ---------------------------------------------------------------------------


class ExceptionBucketCreateRequest(BaseModel):
    code: str
    name: str
    description: str | None = None

    @field_validator("code")
    @classmethod
    def code_not_empty(cls, v: str) -> str:
        v = v.strip().upper()
        if not v:
            raise ValueError("code must not be empty")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v


class ExceptionBucketPatchRequest(BaseModel):
    active: bool | None = None
    name: str | None = None
    description: str | None = None


class ExceptionBucketRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    code: str
    name: str
    description: str | None
    active: bool
    created_at: datetime


class ExceptionBucketListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[ExceptionBucketRow]
    total: int


# ---------------------------------------------------------------------------
# Audit log (A5)
# ---------------------------------------------------------------------------


class AuditLogRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    actor_user_id: UUID | None
    actor_email: str | None
    action: str
    entity_type: str
    entity_id: UUID | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[AuditLogRow]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------------------
# Email outbox (A2)
# ---------------------------------------------------------------------------


class EmailOutboxRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    rule_type: str
    snapshot_id: UUID | None
    subject: str
    status: str
    attempts: int
    enqueued_at: datetime
    sent_at: datetime | None
    last_error: str | None


class EmailOutboxListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[EmailOutboxRow]
    total: int
    page: int
    page_size: int


class EmailOutboxMarkSentRequest(BaseModel):
    note: str | None = None


class EmailOutboxMarkSentResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    status: str
    sent_at: datetime


# ---------------------------------------------------------------------------
# Snapshot list (for S1 and /snapshots listing)
# ---------------------------------------------------------------------------


class SnapshotListRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    entity_code: str
    source_hint: str
    status: str
    as_of_date: str | None  # ISO date string
    uploaded_at: datetime
    uploaded_by_email: str
    row_count: int | None
    total_outstanding: str | None


class SnapshotListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[SnapshotListRow]
    total: int
    page: int
    page_size: int


class SnapshotDetailResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    entity_code: str
    source_hint: str
    status: str
    as_of_date: str | None
    uploaded_at: datetime
    uploaded_by_email: str
    published_at: datetime | None
    published_by_email: str | None
    published_as: str | None
    row_count: int | None
    total_outstanding: str | None
