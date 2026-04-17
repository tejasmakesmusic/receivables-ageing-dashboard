"""Common parser dataclasses and helpers (spec §4.4).

All parsers return ``ParseResult`` containing ``StagedInvoice`` and/or
``StagedCreditPeriod`` instances.  This module is pure: no DB writes, no I/O.
No ``datetime.today()`` / ``datetime.now()`` anywhere.
"""

from __future__ import annotations

import hashlib
from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    values via ``str()`` when constructing it inside each parser.  The model
    itself accepts ``dict[str, Any]`` without enforcing serialisability so that
    tests can pass plain dicts without ceremony.
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

    # --- Xero-only (Task 3); None for Tally / Credit Period ---
    xero_metadata: dict[str, Any] | None = None

    # --- error path ---
    parse_error_reason: str | None = None

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

    # Set by Xero parser (Task 3); None for Tally / Credit Period.
    as_of_date: date | None = None

    file_sha256: str
    source_hint: Literal["TALLY", "XERO", "CREDIT_PERIOD"]

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
