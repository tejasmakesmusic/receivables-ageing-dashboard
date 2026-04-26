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
    """Counts from a single publish operation.

    Invoice-path fields (from Tally/Xero publishes) default to 0 so a
    CREDIT_PERIOD publish can populate only the CP-path fields without
    leaving the invoice counters as sentinel values — and vice versa.
    """

    model_config = ConfigDict(frozen=True)

    # Invoice-path counters (Tally/Xero)
    invoices_inserted: int = 0
    invoices_updated: int = 0
    invoices_settled: int = 0
    invoice_snapshots_written: int = 0
    exceptions_auto_resolved: int = 0
    exceptions_material_change_flagged: int = 0
    publish_notif_enqueued: bool = False

    # CP-path counters (per ADR-0005)
    credit_period_configs_inserted: int = 0
    credit_period_configs_superseded: int = 0
    credit_period_configs_noop: int = 0
    canonicals_auto_created: int = 0
    aliases_auto_created: int = 0


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
