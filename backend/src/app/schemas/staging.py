"""Pydantic v2 schemas for staging review API (M3 Task 4).

Covers:
  GET /snapshots/{id}/staging         → StagingViewResponse
  PATCH /snapshots/{id}/staging/{row} → StagingPatchRequest / StagingPatchResponse
  PATCH /snapshots/{id}/warnings/ack  → WarningsAckRequest / PublishGate

AliasResolution and AliasCandidate are imported from alias_resolver (Option A —
the models live canonically in the service that produces them; no duplication).
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in Pydantic field types
from datetime import date, datetime  # noqa: TCH003 — used at runtime in Pydantic field types
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Re-export for OpenAPI discoverability and test imports.
from app.services.alias_resolver import AliasCandidate, AliasResolution

__all__ = [
    "AliasResolution",
    "AliasCandidate",
    "AnalystOverridesInvoice",
    "AnalystOverridesCreditPeriod",
    "StagingInvoiceRow",
    "StagingCreditPeriodRow",
    "StagingTotals",
    "PublishGate",
    "PaginationMeta",
    "StagingViewResponse",
    # PATCH request bodies
    "PatchResolveAlias",
    "PatchCreateCanonical",
    "PatchOverrideCreditDays",
    "PatchDismissParseError",
    "PatchUndismissParseError",
    "StagingPatchRequest",
    "StagingPatchResponse",
    # Warnings ack
    "WarningsAckRequest",
    "WarningsAckResponse",
    "BulkCreateCanonicalsRequest",
    "BulkCreateCanonicalsResponse",
]


# ---------------------------------------------------------------------------
# Analyst override state (derived from staging_overrides_json at read time)
# ---------------------------------------------------------------------------


class AnalystOverridesInvoice(BaseModel):
    """Effective analyst overrides for one invoice row (derived, not stored directly)."""

    model_config = ConfigDict(frozen=True)

    resolved_canonical_id: uuid.UUID | None = None
    credit_days_override: int | None = None
    credit_days_source: Literal["CONFIG", "DEFAULT", "MANUAL"] | None = None
    dismissed: bool = False


class AnalystOverridesCreditPeriod(BaseModel):
    """Effective analyst overrides for one credit period row."""

    model_config = ConfigDict(frozen=True)

    resolved_canonical_id: uuid.UUID | None = None
    dismissed: bool = False


# ---------------------------------------------------------------------------
# Row shapes
# ---------------------------------------------------------------------------


class StagingInvoiceRow(BaseModel):
    """One staged invoice row as returned by GET /staging."""

    model_config = ConfigDict(frozen=True)

    row_index: int
    status: Literal["OK", "PARSE_ERROR"]
    party_name_raw: str
    invoice_ref: str | None = None
    invoice_date: date | None = None
    amount: str | None = None  # Decimal serialised as string
    source_currency: Literal["INR", "AED"]
    parse_error_reason: str | None = None
    alias_resolution: AliasResolution
    analyst_overrides: AnalystOverridesInvoice
    xero_metadata: dict[str, Any] | None = None
    raw_row_json: dict[str, Any]


class StagingCreditPeriodRow(BaseModel):
    """One staged credit period row as returned by GET /staging."""

    model_config = ConfigDict(frozen=True)

    row_index: int
    entity_code: Literal["IND", "UAE"]
    name: str
    credit_days: int
    reason_note: str | None = None
    analyst_overrides: AnalystOverridesCreditPeriod


# ---------------------------------------------------------------------------
# Totals + publish gate
# ---------------------------------------------------------------------------


class StagingTotals(BaseModel):
    model_config = ConfigDict(frozen=True)

    invoices_total: int
    invoices_ok: int
    invoices_parse_error: int
    credit_periods_total: int
    parse_warnings: int
    parse_errors_file_level: int  # should be 0 on a successfully-created snapshot


class PublishGate(BaseModel):
    model_config = ConfigDict(frozen=True)

    ok: bool  # True iff all 5 sub-gates pass
    unmapped_parties_count: int
    fuzzy_high_pending_count: int
    parse_errors_unresolved_count: int
    warnings_unacknowledged: list[str]  # warning codes not yet acked
    role_permits_publish: bool


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


class PaginationMeta(BaseModel):
    model_config = ConfigDict(frozen=True)

    offset: int
    limit: int
    total: int  # filtered count


# ---------------------------------------------------------------------------
# GET /snapshots/{id}/staging response
# ---------------------------------------------------------------------------


class StagingViewResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    snapshot_id: uuid.UUID
    snapshot_status: Literal["STAGED", "PUBLISHED", "DISCARDED"]
    entity_code: Literal["IND", "UAE"]
    as_of_date: date | None
    source_hint: Literal["TALLY", "XERO", "CREDIT_PERIOD"]
    file_sha256: str
    uploaded_by: str  # user email
    uploaded_at: datetime
    totals: StagingTotals
    publish_gate: PublishGate
    rows: list[StagingInvoiceRow] | list[StagingCreditPeriodRow]
    pagination: PaginationMeta


# ---------------------------------------------------------------------------
# PATCH request body — discriminated union on `action`
# ---------------------------------------------------------------------------


class PatchResolveAlias(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: Literal["resolve_alias"]
    canonical_id: uuid.UUID
    create_alias: bool = True


class PatchCreateCanonical(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: Literal["create_canonical"]
    canonical_name: str
    alias_text: str = ""  # defaults to raw party name if empty
    notes: str = ""


class PatchOverrideCreditDays(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: Literal["override_credit_days"]
    credit_days: Annotated[int, Field(ge=0)]
    reason: str = ""


class PatchDismissParseError(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: Literal["dismiss_parse_error"]
    reason: str


class PatchUndismissParseError(BaseModel):
    model_config = ConfigDict(frozen=True)

    action: Literal["undismiss_parse_error"]


# Discriminated union — FastAPI will deserialise based on `action` value.
StagingPatchRequest = Annotated[
    PatchResolveAlias
    | PatchCreateCanonical
    | PatchOverrideCreditDays
    | PatchDismissParseError
    | PatchUndismissParseError,
    Field(discriminator="action"),
]


# ---------------------------------------------------------------------------
# PATCH response — updated row + updated gate
# ---------------------------------------------------------------------------


class StagingPatchResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    row: StagingInvoiceRow | StagingCreditPeriodRow
    publish_gate: PublishGate


# ---------------------------------------------------------------------------
# PATCH /warnings/ack
# ---------------------------------------------------------------------------


class WarningsAckRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    codes: list[str] = Field(min_length=1)


class WarningsAckResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    acknowledged: list[str]
    publish_gate: PublishGate


# ---------------------------------------------------------------------------
# POST /snapshots/{id}/staging/bulk-create-canonicals
# ---------------------------------------------------------------------------


class BulkCreateCanonicalsRequest(BaseModel):
    """Request body for the bulk-create-canonicals endpoint.

    include_fuzzy (default False): when True, also create new canonicals for
    FUZZY_HIGH and FUZZY_LOW rows — rejecting the resolver's suggestion in
    favor of a fresh canonical keyed on the raw name.  Use when the analyst
    has reviewed the fuzzy suggestions and concluded that none of them fit.
    """

    model_config = ConfigDict(frozen=True)

    include_fuzzy: bool = False


class BulkCreateCanonicalsResponse(BaseModel):
    """Summary of a bulk-create-canonicals operation.

    `distinct_unmapped_names` counts the distinct raw names that were
    processed — "unmapped" is shorthand for "rows that didn't have an EXACT
    canonical yet", which expands to include fuzzy rows when
    `include_fuzzy=True` was sent on the request.
    """

    model_config = ConfigDict(frozen=True)

    distinct_unmapped_names: int
    created_canonicals: int
    created_aliases: int
    skipped_existing_canonical: int
    skipped_existing_alias: int
    publish_gate: PublishGate


# ---------------------------------------------------------------------------
# Error shapes
# ---------------------------------------------------------------------------


class SnapshotNotStagedError(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str = Field(default="SNAPSHOT_NOT_STAGED", frozen=True)
    snapshot_status: str
    detail: str = "Staging review is only available for snapshots in STAGED status."


class RowNotFoundError(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str = Field(default="ROW_NOT_FOUND", frozen=True)
    row_index: int


class InvalidActionForRowError(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: str = Field(default="INVALID_ACTION_FOR_ROW", frozen=True)
    detail: str
