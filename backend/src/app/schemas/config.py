"""Pydantic v2 schemas for /config/credit-period and /config/aliases CRUD (M3 Task 6).

Covers:
  GET /config/credit-period                    → CreditPeriodListResponse
  POST /config/credit-period                   → CreditPeriodCreateRequest / CreditPeriodRow
  PATCH /config/credit-period/:id              → CreditPeriodPatchRequest / CreditPeriodRow
  GET /config/credit-period/default-parties    → DefaultCpReportResponse  (A.4)
  GET /config/aliases                          → AliasListResponse
  POST /config/aliases                         → AliasCreateRequest / AliasRow
  PATCH /config/aliases/:id                    → AliasPatchRequest / AliasRow
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in Pydantic field types
from datetime import date, datetime  # noqa: TCH003 — used at runtime in Pydantic field types
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    # Credit period
    "CreditPeriodRow",
    "CreditPeriodCreateRequest",
    "CreditPeriodPatchRequest",
    "CreditPeriodListResponse",
    "CreditPeriodEditRequest",
    "CreditPeriodEditResponse",
    # Default-CP report (A.4 spec §13 #5)
    "DefaultCpPartyReportRow",
    "DefaultCpReportResponse",
    # Aliases
    "AliasRow",
    "AliasCreateRequest",
    "AliasPatchRequest",
    "AliasListResponse",
    # Pagination
    "PaginationMeta",
]


# ---------------------------------------------------------------------------
# Shared pagination
# ---------------------------------------------------------------------------


class PaginationMeta(BaseModel):
    model_config = ConfigDict(frozen=True)

    page: int
    page_size: int
    total: int
    total_pages: int


# ---------------------------------------------------------------------------
# Credit-period config schemas
# ---------------------------------------------------------------------------


class CreditPeriodRow(BaseModel):
    """One credit_period_config row as returned by GET / POST / PATCH."""

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    canonical_id: uuid.UUID
    canonical_name: str  # denormalised for UI convenience
    entity_code: Literal["IND", "UAE"]
    credit_days: int
    reason_note: str | None
    valid_from: date
    valid_to: date | None  # NULL = open (currently active)
    created_by: uuid.UUID
    created_at: datetime


class CreditPeriodCreateRequest(BaseModel):
    """Body for POST /config/credit-period.

    Design note: valid_from is required from the client — we do NOT read
    date.today() in service code (CLAUDE.md guardrail: no datetime.today() for
    DB defaults). If the caller omits valid_from, FastAPI will return 422.
    The route doc-string explains that clients should pass today's date if no
    specific effective date is intended.
    """

    model_config = ConfigDict(frozen=True)

    canonical_id: uuid.UUID
    credit_days: Annotated[int, Field(ge=0)]
    reason_note: str | None = None
    valid_from: date  # required; client passes today if no specific date needed


class CreditPeriodPatchRequest(BaseModel):
    """Body for PATCH /config/credit-period/:id.

    Only the open row (valid_to IS NULL) may be PATCHed.
    Allows updating credit_days and/or reason_note.
    valid_from, canonical_id, valid_to are immutable via PATCH — versioning
    is done by POST (which closes the prior open row and inserts a new one).
    """

    model_config = ConfigDict(frozen=True)

    credit_days: Annotated[int | None, Field(ge=0)] = None
    reason_note: str | None = None  # None means "no change"; use explicit empty string to clear


class CreditPeriodListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[CreditPeriodRow]
    pagination: PaginationMeta


class CreditPeriodEditRequest(BaseModel):
    """Body for POST /config/credit-period/{canonical_id} — analyst-facing one-off edit.

    Supersedes the active credit_period_config row for the given canonical party
    (ADR-0005 D3 supersede logic). Idempotent: if (days, reason_note) matches the
    currently active config, returns result='noop' with no DB writes.
    """

    model_config = ConfigDict(frozen=True)

    days: Annotated[int, Field(ge=0)]
    reason_note: str | None = None


class CreditPeriodEditResponse(BaseModel):
    """Response for POST /config/credit-period/{canonical_id}."""

    model_config = ConfigDict(frozen=True)

    result: Literal["inserted", "superseded", "noop"]
    config_id: uuid.UUID
    days: int
    reason_note: str | None
    valid_from: date


# ---------------------------------------------------------------------------
# Default-CP report schemas (A.4 — spec §13 #5)
# ---------------------------------------------------------------------------


class DefaultCpPartyReportRow(BaseModel):
    """One party row in the default-CP report, as returned by
    GET /config/credit-period/default-parties."""

    model_config = ConfigDict(frozen=True)

    canonical_id: uuid.UUID
    canonical_name: str
    total_outstanding: str  # Decimal serialised as string for JSON transport
    n_open_invoices: int


class DefaultCpReportResponse(BaseModel):
    """Response for GET /config/credit-period/default-parties (A.4)."""

    model_config = ConfigDict(frozen=True)

    entity_code: Literal["IND", "UAE"]
    as_of_date: date
    snapshot_id: uuid.UUID
    currency_display: str
    total_parties_on_default: int
    # Top 20 sorted by outstanding desc (service already orders).
    parties: list[DefaultCpPartyReportRow]


# ---------------------------------------------------------------------------
# Alias config schemas
# ---------------------------------------------------------------------------


class AliasRow(BaseModel):
    """One party_aliases row as returned by GET / POST / PATCH."""

    model_config = ConfigDict(frozen=True)

    id: uuid.UUID
    canonical_id: uuid.UUID
    canonical_name: str  # denormalised for UI convenience
    entity_code: Literal["IND", "UAE"]
    alias_text: str
    source: Literal["TALLY", "XERO", "MANUAL"]
    created_by: uuid.UUID
    created_at: datetime


class AliasCreateRequest(BaseModel):
    """Body for POST /config/aliases.

    Aliases created via this endpoint are always source='MANUAL'.
    Parsers create TALLY/XERO source aliases; manual review creates MANUAL.
    alias_text is stripped of leading/trailing whitespace; empty string → 422.
    """

    model_config = ConfigDict(frozen=True)

    canonical_id: uuid.UUID
    alias_text: Annotated[str, Field(min_length=1)]
    source: Literal["MANUAL"] = "MANUAL"


class AliasPatchRequest(BaseModel):
    """Body for PATCH /config/aliases/:id.

    ADMIN only. Updates alias_text. The UNIQUE(alias_text, canonical_id)
    constraint still applies; collisions → 409 ALIAS_ALREADY_EXISTS.
    """

    model_config = ConfigDict(frozen=True)

    alias_text: Annotated[str, Field(min_length=1)]


class AliasListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[AliasRow]
    pagination: PaginationMeta
