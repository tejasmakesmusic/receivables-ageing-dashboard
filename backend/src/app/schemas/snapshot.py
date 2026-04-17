"""Pydantic v2 request/response schemas for POST /snapshots (spec §10 + M3 Task 2).

Form-data bindings use FastAPI ``Form(...)`` fields.  Response models are plain
Pydantic BaseModels.  All error shapes carry a ``code`` field so callers can
switch on them without parsing human-readable ``detail`` strings.
"""

from __future__ import annotations

from datetime import date  # noqa: TCH003 — used at runtime in Pydantic field types
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Warning shape (mirrors ParseError in parsers/common.py but without row_index
# for the public API surface — the full ParseResult is stored internally in
# parse_result_json; the response only surfaces aggregate counts + warnings).
# ---------------------------------------------------------------------------


class WarningItem(BaseModel):
    model_config = ConfigDict(frozen=True)
    code: str
    message: str
    detail: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Parse summary (subset of ParseResult surfaced in the 201 response)
# ---------------------------------------------------------------------------


class ParseSummary(BaseModel):
    model_config = ConfigDict(frozen=True)
    invoices_parsed: int
    credit_periods_parsed: int
    parse_error_count: int
    warnings: list[WarningItem]


# ---------------------------------------------------------------------------
# 201 Created response
# ---------------------------------------------------------------------------


class SnapshotCreateResponse(BaseModel):
    model_config = ConfigDict(frozen=True)
    snapshot_id: str  # UUID as string for JSON interop
    status: Literal["STAGED"]
    source_hint: Literal["TALLY", "XERO", "CREDIT_PERIOD"]
    as_of_date: date | None
    file_sha256: str
    parse_summary: ParseSummary


# ---------------------------------------------------------------------------
# 409 Conflict — duplicate file
# ---------------------------------------------------------------------------


class DuplicateFileError(BaseModel):
    model_config = ConfigDict(frozen=True)
    code: str = Field(default="DUPLICATE_FILE", frozen=True)
    file_sha256: str
    existing_snapshot_id: str  # UUID as string


# ---------------------------------------------------------------------------
# 422 — partition not found
# ---------------------------------------------------------------------------


class MissingPartitionError(BaseModel):
    model_config = ConfigDict(frozen=True)
    code: str = Field(default="MISSING_PARTITION", frozen=True)
    as_of_date: date
    hint: str = Field(
        default=(
            "Partition for this quarter has not been created yet; "
            "see docs/runbook.md §Partitioning invoice_snapshots."
        )
    )


# ---------------------------------------------------------------------------
# 422 — as_of_date missing
# ---------------------------------------------------------------------------


class AsOfDateMissingError(BaseModel):
    model_config = ConfigDict(frozen=True)
    code: str = Field(default="AS_OF_DATE_MISSING", frozen=True)
    detail: str
