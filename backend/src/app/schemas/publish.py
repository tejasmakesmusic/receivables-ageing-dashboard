"""Pydantic v2 schemas for POST /snapshots/:id/publish (M3 Task 5).

Covers:
  POST /snapshots/{id}/publish → PublishRequest / PublishResponse
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in Pydantic field types
from datetime import (
    datetime,  # noqa: TCH003 — used at runtime in Pydantic field types  # noqa: I001
)
from typing import Literal

from pydantic import BaseModel, ConfigDict

# ---------------------------------------------------------------------------
# Nested response models
# ---------------------------------------------------------------------------


class UserRef(BaseModel):
    """Minimal user reference embedded in publish response."""

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    email: str


class PublishResult(BaseModel):
    """Counts from a single publish operation."""

    model_config = ConfigDict(frozen=True)

    invoices_inserted: int
    invoices_updated: int
    invoices_settled: int
    invoice_snapshots_written: int
    exceptions_auto_resolved: int
    exceptions_material_change_flagged: int
    publish_notif_enqueued: bool


# ---------------------------------------------------------------------------
# Request body
# ---------------------------------------------------------------------------


class PublishRequest(BaseModel):
    """Optional body for POST /snapshots/:id/publish.

    ``override_reason`` is only meaningful when an ADMIN publishes a snapshot
    that belongs to a different analyst's entity scope (D17).  The reason is
    stored in the audit log after_json.
    """

    model_config = ConfigDict(frozen=True)

    override_reason: str | None = None


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class PublishResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    snapshot_id: uuid.UUID
    status: Literal["PUBLISHED"]
    published_at: datetime
    published_by: UserRef
    published_as: Literal["NORMAL", "OVERRIDE"]
    result: PublishResult


# ---------------------------------------------------------------------------
# Error shapes
# ---------------------------------------------------------------------------


class CreditPeriodPublishNotImplementedError(BaseModel):
    """Structured error returned when trying to publish a CREDIT_PERIOD snapshot."""

    model_config = ConfigDict(frozen=True)

    code: str = "CREDIT_PERIOD_PUBLISH_NOT_IMPLEMENTED_YET_SEE_TASK_6"
    detail: str = (
        "CREDIT_PERIOD snapshots are published via Task 6, which writes "
        "versioned rows to credit_period_config (valid_from / valid_to). "
        "Use POST /snapshots/:id/publish-credit-period (Task 6 endpoint)."
    )
