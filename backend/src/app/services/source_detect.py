"""Source auto-detection from XLSX sheet names (M3 Task 2).

Public interface::

    detect_source_from_xlsx(file_bytes: bytes) -> Literal["TALLY", "XERO", "CREDIT_PERIOD"] | None

Returns None when no match is found.  Raises ``AmbiguousSourceError`` when
more than one source matches the sheet names.

Detection rules (in order of precedence):
  1. Contains "Sundry Debtors"                          → TALLY
  2. Contains "Aged Receivables Detail"                 → XERO
  3. Contains BOTH "India" AND "UAE"                    → CREDIT_PERIOD
  4. Multiple rules match                               → AmbiguousSourceError
  5. No rule matches                                    → None
"""

from __future__ import annotations

import io
from typing import Literal

import openpyxl

SourceHint = Literal["TALLY", "XERO", "CREDIT_PERIOD"]


class AmbiguousSourceError(Exception):
    """Raised when sheet names match more than one source."""

    def __init__(self, matched: list[SourceHint]) -> None:
        self.matched = matched
        super().__init__(
            f"Sheet names match multiple sources: {matched!r}. "
            "Please supply source_hint explicitly."
        )


def detect_source_from_xlsx(file_bytes: bytes) -> SourceHint | None:
    """Detect source from XLSX sheet names.

    Args:
        file_bytes: Raw bytes of the uploaded XLSX file.

    Returns:
        One of ``"TALLY"``, ``"XERO"``, ``"CREDIT_PERIOD"``, or ``None``
        when no rules match.

    Raises:
        AmbiguousSourceError: When multiple detection rules match simultaneously.
        openpyxl.utils.exceptions.InvalidFileException: If the bytes are not
            a valid XLSX (propagated to caller for a 400 response).
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    sheet_names: set[str] = set(wb.sheetnames)
    wb.close()

    matched: list[SourceHint] = []

    if "Sundry Debtors" in sheet_names:
        matched.append("TALLY")

    if "Aged Receivables Detail" in sheet_names:
        matched.append("XERO")

    if "India" in sheet_names and "UAE" in sheet_names:
        matched.append("CREDIT_PERIOD")

    if len(matched) > 1:
        raise AmbiguousSourceError(matched)

    return matched[0] if matched else None


def validate_source_hint_against_file(file_bytes: bytes, caller_hint: SourceHint) -> None:
    """Ensure the caller-supplied hint matches the file's sheet names.

    Args:
        file_bytes: Raw bytes of the uploaded XLSX file.
        caller_hint: The ``source_hint`` value supplied by the caller.

    Raises:
        ValueError: If the detected source does not match ``caller_hint``.
        AmbiguousSourceError: Propagated from ``detect_source_from_xlsx``.
    """
    detected = detect_source_from_xlsx(file_bytes)

    # If detection returns None (no rule matched), we cannot validate —
    # trust the caller's hint.  The parser will raise if the sheet is missing.
    if detected is None:
        return

    if detected != caller_hint:
        raise ValueError(
            f"source_hint mismatch: caller supplied {caller_hint!r} but "
            f"file sheet names indicate {detected!r}."
        )
