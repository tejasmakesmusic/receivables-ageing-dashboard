"""Pydantic v2 schemas for POST /snapshots/:id/discard (M3 Task 6).

Covers:
  POST /snapshots/{id}/discard → DiscardRequest / DiscardResponse
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in Pydantic field types
from datetime import (
    datetime,  # noqa: TCH003 — used at runtime in Pydantic field types
)
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.publish import UserRef  # noqa: TCH001 — used at runtime in Pydantic field type

__all__ = ["DiscardRequest", "DiscardResponse"]


class DiscardRequest(BaseModel):
    """Optional request body for POST /snapshots/:id/discard."""

    model_config = ConfigDict(frozen=True)

    reason: str | None = None  # free-text reason; stored in audit_log.after


class DiscardResponse(BaseModel):
    """Response from POST /snapshots/:id/discard."""

    model_config = ConfigDict(frozen=True)

    snapshot_id: uuid.UUID
    status: Literal["DISCARDED"]
    discarded_at: datetime
    discarded_by: UserRef
    reason: str | None
