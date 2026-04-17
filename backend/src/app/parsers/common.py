"""Common parser dataclasses and helpers (spec §4.4).

All parsers return ``ParseResult`` containing ``StagedInvoice`` and/or
``StagedCreditPeriod`` instances.  This module is pure: no DB writes, no I/O.
No ``datetime.today()`` / ``datetime.now()`` anywhere.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

import pandas as pd

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ParseStatus(StrEnum):
    OK = "OK"
    PARSE_ERROR = "PARSE_ERROR"


# ---------------------------------------------------------------------------
# StagedInvoice
# ---------------------------------------------------------------------------


class StagedInvoice(BaseModel):
    """One row from Tally (INR) or Xero (AED), normalised for staging.

    Fields map directly onto the ``invoices`` staging columns (spec §3):
    ``source_currency``, ``invoice_date``, ``invoice_ref``, ``amount``,
    ``party_name_raw``, ``raw_row_json``, ``row_index``.

    ``raw_row_json`` must be JSON-serialisable — stringify date/Decimal/datetime
    values via ``str()`` when constructing it inside each parser.  Construction
    raises ``ValidationError`` if any value is not JSON-serialisable.
    """

    model_config = ConfigDict(frozen=True)

    # --- identity ---
    row_index: int
    status: ParseStatus = ParseStatus.OK

    # --- source ---
    source_currency: Literal["INR", "AED"]

    # --- core fields ---
    party_name_raw: str
    invoice_ref: str | None = None
    invoice_date: date | None = None
    amount: Decimal | None = None

    # --- raw storage ---
    raw_row_json: dict[str, Any]

    # --- populated by the Xero parser only; None for Tally and Credit Period ---
    xero_metadata: dict[str, Any] | None = None

    # --- error path ---
    parse_error_reason: str | None = None

    @field_validator("raw_row_json")
    @classmethod
    def _raw_row_json_must_be_json_safe(cls, v: dict[str, Any]) -> dict[str, Any]:
        try:
            json.dumps(v)
        except (TypeError, ValueError) as e:
            raise ValueError(f"raw_row_json must be JSON-serializable: {e}") from e
        return v

    @field_serializer("amount")
    def _ser_amount(self, v: Decimal | None) -> str | None:
        return None if v is None else str(v)

    @model_validator(mode="after")
    def _check_ok_completeness_and_error_reason(self) -> StagedInvoice:
        """Enforce field invariants depending on status."""
        if self.status == ParseStatus.PARSE_ERROR:
            if not self.parse_error_reason:
                raise ValueError(
                    "parse_error_reason must be a non-empty string when status=PARSE_ERROR"
                )
        else:  # OK
            missing: list[str] = []
            if self.invoice_ref is None:
                missing.append("invoice_ref")
            if self.invoice_date is None:
                missing.append("invoice_date")
            if self.amount is None:
                missing.append("amount")
            if missing:
                raise ValueError(f"Fields {missing} must not be None when status=OK")
        return self


# ---------------------------------------------------------------------------
# StagedCreditPeriod
# ---------------------------------------------------------------------------


class StagedCreditPeriod(BaseModel):
    """One row from the Credit Period master (India or UAE sheet, spec §4.3)."""

    model_config = ConfigDict(frozen=True)

    row_index: int
    entity_code: Literal["IND", "UAE"]
    name: str
    credit_days: int
    reason_note: str | None = None  # UAE only

    @field_validator("name")
    @classmethod
    def _name_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must be a non-empty string")
        return v

    @field_validator("credit_days")
    @classmethod
    def _credit_days_nonneg(cls, v: int) -> int:
        if v < 0:
            raise ValueError("credit_days must be >= 0")
        return v


# ---------------------------------------------------------------------------
# ParseError
# ---------------------------------------------------------------------------


class ParseError(BaseModel):
    """Structured error or warning from any parser.

    Use ``row_index=-1`` for file-level errors (sentinel per spec §4.4).
    Reused for both ``errors`` and ``warnings`` lists in ``ParseResult``.
    """

    model_config = ConfigDict(frozen=True)

    row_index: int  # -1 = file-level sentinel
    code: str  # e.g. "UNPARSEABLE_ROW", "GRAND_TOTAL_MISMATCH"
    message: str
    detail: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# ParseResult
# ---------------------------------------------------------------------------


class ParseResult(BaseModel):
    """Aggregate output of a single parser run (spec §4.4).

    ``errors`` block publish; ``warnings`` do not (``is_valid`` property).
    """

    model_config = ConfigDict(frozen=True)

    invoices: list[StagedInvoice] = Field(default_factory=list)
    credit_periods: list[StagedCreditPeriod] = Field(default_factory=list)
    errors: list[ParseError] = Field(default_factory=list)
    warnings: list[ParseError] = Field(default_factory=list)

    # Populated by the Xero parser only; None for Tally and Credit Period.
    as_of_date: date | None = None

    file_sha256: str
    source_hint: Literal["TALLY", "XERO", "CREDIT_PERIOD"]

    @field_validator("file_sha256")
    @classmethod
    def _file_sha256_must_be_hex64(cls, v: str) -> str:
        _SHA256_HEX_LEN = 64  # noqa: N806
        if len(v) != _SHA256_HEX_LEN or not all(c in "0123456789abcdef" for c in v):
            raise ValueError("file_sha256 must be a 64-char lowercase hex digest")
        return v

    @property
    def is_valid(self) -> bool:
        """True iff no errors.  Warnings do NOT block validity (spec §4.4)."""
        return len(self.errors) == 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def compute_file_sha256(file_bytes: bytes) -> str:
    """Return hex-encoded SHA-256 digest of *file_bytes* (spec §4.4)."""
    return hashlib.sha256(file_bytes).hexdigest()


def is_empty_cell(val: Any) -> bool:
    """Return True if a pandas/xlsx cell should be treated as empty.

    Handles NaN, NaT, None, and empty-or-whitespace-only strings.
    Shared by all parsers (Tally, Xero, Credit Period) to ensure consistent
    empty-cell detection without per-parser divergence.
    """
    if val is None:
        return True
    try:
        if pd.isna(val):
            return True
    except (TypeError, ValueError):
        pass
    return isinstance(val, str) and not val.strip()


def stringify_cell(val: Any) -> str | None:
    """Coerce a pandas/xlsx cell to str | None for JSON-safe storage.

    Returns None for empty cells (via is_empty_cell), str(val) otherwise.
    Shared by all parsers so raw_row_json construction is consistent.
    """
    if is_empty_cell(val):
        return None
    return str(val)
