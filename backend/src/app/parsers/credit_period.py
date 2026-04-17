"""Credit Period master parser — spec §4.3 (M2 Task 4).

Public interface::

    def parse_credit_period_master(file_bytes: bytes) -> ParseResult: ...

Sheets: "India" and "UAE".

India columns: Client Name | Credit Period (2 cols)
UAE columns:   Client Name | Credit Period | Reason for extended Credit | Amount (4 cols)

Guardrails (spec §15 + CLAUDE.md):
- Drop UAE `Amount` column entirely — D20, non-negotiable.
  The value NEVER reaches StagedCreditPeriod, ParseError.detail, logs, or any
  derived artifact.
- Empty Client Name rows → SKIP silently (cosmetic blank separators).
- Duplicate client names within a sheet → FAIL parse (DUPLICATE_CLIENT error).
- No datetime.today() / datetime.now().
- No print statements — structlog with aggregate counts only, never raw names.
- No DB writes.

Fixture deviation (2026-04-17):
  Spec §4.3 names the UAE reason column "Reason for extended Credit Period".
  The real fixture has "Reason for extended Credit" (truncated).
  The parser accepts both variants via startswith prefix matching to be robust.
"""

from __future__ import annotations

import io
from typing import Any, Literal

import pandas as pd
import structlog
from pydantic import ValidationError

from app.parsers.common import (
    ParseError,
    ParseResult,
    StagedCreditPeriod,
    compute_file_sha256,
    is_empty_cell,
)

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Sheet / column constants
# ---------------------------------------------------------------------------

_SHEET_INDIA = "India"
_SHEET_UAE = "UAE"

# Required column names (case-sensitive, must match fixture headers exactly).
_COL_CLIENT_NAME = "Client Name"
_COL_CREDIT_PERIOD = "Credit Period"

# UAE reason column: real fixture = "Reason for extended Credit"
# Spec §4.3 says "Reason for extended Credit Period".
# We match by prefix so both variants work.
_COL_REASON_PREFIX = "Reason for extended Credit"

# UAE Amount column — D20: must NEVER be persisted.
_COL_AMOUNT = "Amount"


# ---------------------------------------------------------------------------
# Header detection helpers
# ---------------------------------------------------------------------------


def _find_header_row(df: pd.DataFrame) -> int | None:
    """Return the 0-indexed row number whose col-0 cell equals 'Client Name'.

    Returns None if no such row exists within the first 20 rows (guards
    against infinite scan on malformed files).
    """
    for idx in range(min(20, len(df))):
        cell = df.iloc[idx, 0]
        if isinstance(cell, str) and cell.strip() == _COL_CLIENT_NAME:
            return idx
    return None


def _build_col_map(df: pd.DataFrame, header_row_idx: int) -> dict[str, int]:
    """Build column-name → positional-index map from the header row.

    Only non-empty string cells are included.
    """
    col_map: dict[str, int] = {}
    for col_idx, val in enumerate(df.iloc[header_row_idx]):
        if isinstance(val, str) and val.strip():
            col_map[val.strip()] = col_idx
    return col_map


def _find_reason_col(col_map: dict[str, int]) -> int | None:
    """Locate the UAE reason column, accepting both spec and fixture names.

    Searches for any key that starts with _COL_REASON_PREFIX (case-sensitive).
    Returns the positional index, or None if not found.
    """
    for name, idx in col_map.items():
        if name.startswith(_COL_REASON_PREFIX):
            return idx
    return None


# ---------------------------------------------------------------------------
# Per-sheet parse helpers
# ---------------------------------------------------------------------------


def _parse_credit_days(val: Any) -> int | None:  # noqa: PLR0911
    """Coerce a cell value to a non-negative int for credit_days.

    Returns None if the value cannot be parsed to a non-negative integer.
    Does NOT raise — callers emit errors and continue.
    """
    if is_empty_cell(val):
        return None
    # pandas may read integers as float (e.g. 30.0) — handle that.
    if isinstance(val, float):
        if val != int(val):
            return None  # fractional — invalid
        return int(val)
    if isinstance(val, int):
        return val
    # Try string coercion.
    try:
        f = float(str(val).strip())
        if f != int(f):
            return None
        return int(f)
    except (ValueError, TypeError):
        return None


def _parse_sheet(  # noqa: PLR0912,PLR0915
    df: pd.DataFrame,
    sheet_name: str,
    entity_code: Literal["IND", "UAE"],
    errors: list[ParseError],
) -> list[StagedCreditPeriod]:
    """Parse a single India or UAE sheet and return StagedCreditPeriod rows.

    File-level errors (SHEET_NOT_FOUND, MISSING_REQUIRED_COLUMN, DUPLICATE_CLIENT,
    INVALID_CREDIT_DAYS) are appended to *errors* in-place.

    Data-handling: no raw client names in log messages. Counts only.
    """
    staged: list[StagedCreditPeriod] = []

    # ------------------------------------------------------------------ #
    # 1. Find header row                                                   #
    # ------------------------------------------------------------------ #
    header_row_idx = _find_header_row(df)
    if header_row_idx is None:
        errors.append(
            ParseError(
                row_index=-1,
                code="MISSING_REQUIRED_COLUMN",
                message=(
                    f"Sheet '{sheet_name}': cannot locate '{_COL_CLIENT_NAME}' "
                    "header in first 20 rows."
                ),
                detail={"sheet": sheet_name, "missing": [_COL_CLIENT_NAME]},
            )
        )
        return staged

    col_map = _build_col_map(df, header_row_idx)

    # ------------------------------------------------------------------ #
    # 2. Validate required columns are present                            #
    # ------------------------------------------------------------------ #
    missing_cols: list[str] = []
    if _COL_CLIENT_NAME not in col_map:
        missing_cols.append(_COL_CLIENT_NAME)
    if _COL_CREDIT_PERIOD not in col_map:
        missing_cols.append(_COL_CREDIT_PERIOD)

    if entity_code == "UAE":
        reason_col_idx = _find_reason_col(col_map)
        if reason_col_idx is None:
            missing_cols.append(f"{_COL_REASON_PREFIX}[…]")
    else:
        reason_col_idx = None

    if missing_cols:
        errors.append(
            ParseError(
                row_index=-1,
                code="MISSING_REQUIRED_COLUMN",
                message=f"Sheet '{sheet_name}': required columns absent: {missing_cols}",
                detail={"sheet": sheet_name, "missing": missing_cols},
            )
        )
        return staged

    name_col_idx: int = col_map[_COL_CLIENT_NAME]
    credit_col_idx: int = col_map[_COL_CREDIT_PERIOD]
    # NOTE: _COL_AMOUNT is intentionally NOT in col_map resolution — D20.

    # ------------------------------------------------------------------ #
    # 3. Iterate data rows (header_row_idx + 1 → end)                    #
    # ------------------------------------------------------------------ #
    # First pass: collect (name, credit_days, reason_note, row_idx) tuples
    # to enable duplicate detection before emitting.
    collected: list[tuple[str, int, str | None, int]] = []  # (name, credit_days, reason, row_idx)
    parse_errors_local: list[ParseError] = []

    for raw_idx in range(header_row_idx + 1, len(df)):
        row = df.iloc[raw_idx]

        name_val: Any = row.iloc[name_col_idx]

        # -- Empty Client Name → SKIP silently (spec §4.3 rule 4) --
        if is_empty_cell(name_val):
            continue
        if isinstance(name_val, str) and not name_val.strip():
            continue

        name_str = str(name_val).strip()

        # -- Credit Period --
        credit_val: Any = row.iloc[credit_col_idx]
        parsed_days = _parse_credit_days(credit_val)

        if parsed_days is None:
            # Value is either empty or not a parseable integer.
            parse_errors_local.append(
                ParseError(
                    row_index=-1,
                    code="INVALID_CREDIT_DAYS",
                    message=(
                        f"Sheet '{sheet_name}': row {raw_idx} has unparseable " "credit_days value."
                    ),
                    detail={
                        "sheet": sheet_name,
                        "row_index": raw_idx,
                        "value": str(credit_val) if not is_empty_cell(credit_val) else None,
                    },
                )
            )
            continue

        # -- Reason note (UAE only) — D20: Amount NOT touched here --
        reason_note: str | None = None
        if entity_code == "UAE" and reason_col_idx is not None:
            reason_val: Any = row.iloc[reason_col_idx]
            if not is_empty_cell(reason_val):
                reason_note = str(reason_val).strip() or None

        # -- Validate via StagedCreditPeriod model (catches negative credit_days) --
        try:
            StagedCreditPeriod(
                row_index=raw_idx,
                entity_code=entity_code,
                name=name_str,
                credit_days=parsed_days,
                reason_note=reason_note,
            )
        except ValidationError as exc:
            # Extract the first error message for the detail.
            first_msg = exc.errors()[0]["msg"] if exc.errors() else str(exc)
            if "credit_days" in first_msg or "credit_days" in str(exc):
                parse_errors_local.append(
                    ParseError(
                        row_index=-1,
                        code="INVALID_CREDIT_DAYS",
                        message=(f"Sheet '{sheet_name}': row {raw_idx} — {first_msg}"),
                        detail={
                            "sheet": sheet_name,
                            "row_index": raw_idx,
                            "value": str(parsed_days),
                        },
                    )
                )
            else:
                parse_errors_local.append(
                    ParseError(
                        row_index=-1,
                        code="INVALID_CREDIT_DAYS",
                        message=(f"Sheet '{sheet_name}': row {raw_idx} — {first_msg}"),
                        detail={
                            "sheet": sheet_name,
                            "row_index": raw_idx,
                            "value": str(parsed_days),
                        },
                    )
                )
            continue

        collected.append((name_str, parsed_days, reason_note, raw_idx))

    # ------------------------------------------------------------------ #
    # 4. Duplicate detection (within this sheet)                          #
    # ------------------------------------------------------------------ #
    seen: dict[str, int] = {}  # name → first row_idx
    duplicates: list[str] = []
    first_occurrences: dict[str, int] = {}

    for name_str, _days, _reason, row_idx in collected:
        if name_str in seen:
            if name_str not in first_occurrences:
                # First time we detect this as a duplicate — record the first occurrence.
                first_occurrences[name_str] = seen[name_str]
            if name_str not in duplicates:
                duplicates.append(name_str)
        else:
            seen[name_str] = row_idx

    if duplicates:
        errors.append(
            ParseError(
                row_index=-1,
                code="DUPLICATE_CLIENT",
                message=(f"Duplicate client names in {sheet_name}: " f"{len(duplicates)} found"),
                detail={
                    "sheet": sheet_name,
                    "duplicates": duplicates,
                    "first_occurrences": first_occurrences,
                },
            )
        )
        # Per spec §4.3 rule 5: fail the parse for this sheet.
        # Still append any per-row parse errors found during iteration.
        errors.extend(parse_errors_local)
        return staged  # empty — analyst must fix and re-upload

    # No duplicates — extend errors with any per-row parse issues found.
    errors.extend(parse_errors_local)

    # If there were any per-row parse errors, we return partial results
    # (rows that parsed successfully before/after the bad rows) alongside
    # the errors.  is_valid becomes False because errors are non-empty.
    for name_str, parsed_days, reason_note, row_idx in collected:
        staged.append(
            StagedCreditPeriod(
                row_index=row_idx,
                entity_code=entity_code,
                name=name_str,
                credit_days=parsed_days,
                reason_note=reason_note,
            )
        )

    log.info(
        "credit_period_parser.sheet_parsed",
        sheet=sheet_name,
        entity_code=entity_code,
        emitted=len(staged),
        parse_errors=len(parse_errors_local),
    )

    return staged


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------


def parse_credit_period_master(file_bytes: bytes) -> ParseResult:
    """Parse a Credit Period master XLSX file and return a ``ParseResult``.

    Args:
        file_bytes: Raw bytes of the ``.xlsx`` file (from HTTP upload or disk).

    Returns:
        ``ParseResult`` with ``source_hint="CREDIT_PERIOD"``, ``invoices=[]``,
        ``as_of_date=None``.  ``is_valid`` is ``True`` iff ``errors`` is empty.

    D20 guarantee: the UAE ``Amount`` column is never accessed, never stored
    in any StagedCreditPeriod field, and never included in any ParseError.detail.
    """
    sha256 = compute_file_sha256(file_bytes)
    credit_periods: list[StagedCreditPeriod] = []
    errors: list[ParseError] = []

    # ------------------------------------------------------------------ #
    # 1. Load all sheets at once                                           #
    # ------------------------------------------------------------------ #
    try:
        all_sheets: dict[str, pd.DataFrame] = pd.read_excel(
            io.BytesIO(file_bytes),
            sheet_name=None,
            header=None,
            dtype=object,
        )
    except Exception as exc:
        errors.append(
            ParseError(
                row_index=-1,
                code="SHEET_NOT_FOUND",
                message=f"Cannot open workbook: {exc}",
            )
        )
        return ParseResult(
            file_sha256=sha256,
            source_hint="CREDIT_PERIOD",
            errors=errors,
        )

    # ------------------------------------------------------------------ #
    # 2. Check for required sheets (process whichever IS present)         #
    # ------------------------------------------------------------------ #
    india_df: pd.DataFrame | None = all_sheets.get(_SHEET_INDIA)
    uae_df: pd.DataFrame | None = all_sheets.get(_SHEET_UAE)

    if india_df is None:
        errors.append(
            ParseError(
                row_index=-1,
                code="SHEET_NOT_FOUND",
                message=f"Required sheet '{_SHEET_INDIA}' not found in workbook.",
                detail={"sheet": _SHEET_INDIA, "available": list(all_sheets.keys())},
            )
        )

    if uae_df is None:
        errors.append(
            ParseError(
                row_index=-1,
                code="SHEET_NOT_FOUND",
                message=f"Required sheet '{_SHEET_UAE}' not found in workbook.",
                detail={"sheet": _SHEET_UAE, "available": list(all_sheets.keys())},
            )
        )

    # ------------------------------------------------------------------ #
    # 3. Parse whichever sheets are present                               #
    # ------------------------------------------------------------------ #
    if india_df is not None:
        ind_rows = _parse_sheet(india_df, _SHEET_INDIA, "IND", errors)
        credit_periods.extend(ind_rows)

    if uae_df is not None:
        uae_rows = _parse_sheet(uae_df, _SHEET_UAE, "UAE", errors)
        credit_periods.extend(uae_rows)

    log.info(
        "credit_period_parser.completed",
        total_credit_periods=len(credit_periods),
        ind_count=sum(1 for cp in credit_periods if cp.entity_code == "IND"),
        uae_count=sum(1 for cp in credit_periods if cp.entity_code == "UAE"),
        errors=len(errors),
    )

    return ParseResult(
        invoices=[],
        credit_periods=credit_periods,
        errors=errors,
        warnings=[],
        as_of_date=None,
        file_sha256=sha256,
        source_hint="CREDIT_PERIOD",
    )
