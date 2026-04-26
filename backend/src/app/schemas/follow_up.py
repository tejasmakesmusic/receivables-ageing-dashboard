"""Follow-up schemas — POST/PATCH/GET /follow-ups (M5 full, S6 backend)."""

from __future__ import annotations

import datetime as _dt
from typing import Literal
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict, model_validator

# Explicit aliases to avoid shadowing issues when fields are also named 'date'.
_Date = _dt.date
_Datetime = _dt.datetime


class FollowUpBaseRequest(BaseModel):
    """Shared fields for follow-up create requests (no target validation)."""

    date: _Date
    channel: Literal["EMAIL", "CALL", "WHATSAPP", "MEETING"]
    contact_person: str | None = None
    next_action_date: _Date | None = None
    notes: str | None = None
    invoice_id: UUID | None = None
    canonical_id: UUID | None = None


class FollowUpCreateRequest(FollowUpBaseRequest):
    """Create a new follow-up log entry.

    Exactly one of ``invoice_id`` or ``canonical_id`` must be provided.
    Both present, or neither present, raises a validation error.
    """

    @model_validator(mode="after")
    def _exactly_one_target(self) -> FollowUpCreateRequest:
        has_invoice = self.invoice_id is not None
        has_canonical = self.canonical_id is not None
        if has_invoice == has_canonical:  # both True or both False
            raise ValueError(
                "Exactly one of invoice_id or canonical_id must be provided, not both or neither."
            )
        return self


class FollowUpUpdateRequest(BaseModel):
    """Partial update for a follow-up log entry.

    Identity-changing fields (invoice_id, canonical_id) are intentionally
    absent — delete + recreate for target changes.
    """

    date: _Date | None = None
    channel: Literal["EMAIL", "CALL", "WHATSAPP", "MEETING"] | None = None
    contact_person: str | None = None
    next_action_date: _Date | None = None
    notes: str | None = None


class FollowUpRow(BaseModel):
    """Single follow-up row returned from list/get endpoints."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    invoice_id: UUID | None
    canonical_id: UUID
    date: _Date
    channel: str
    contact_person: str | None
    next_action_date: _Date | None
    notes: str | None
    logged_by: UUID
    logged_by_email: str
    logged_at: _Datetime
    canonical_name: str
    invoice_ref: str | None


class FollowUpListResponse(BaseModel):
    """Paginated response for follow-up list endpoint."""

    model_config = ConfigDict(frozen=True)

    items: list[FollowUpRow]
    total: int
    page: int
    page_size: int
