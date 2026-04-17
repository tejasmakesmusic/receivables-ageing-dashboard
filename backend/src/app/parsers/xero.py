"""Xero Aged Receivables Detail parser — spec §4.2 (amended via ADR-0004).

Public interface::

    def parse_xero_aged_receivables(file_bytes: bytes) -> ParseResult: ...

Sheet: "Aged Receivables Detail".  Rows 0–5 are metadata/header; data
starts at row 6.  Row 5 (0-indexed) holds the column headers; the parser
builds a name→index map so it is robust to column reordering.

Row taxonomy (spec §4.2 rules 3–4, ADR-0004):
  - Blank row (all cells empty)            → skip silently
  - Party header (col0 populated, no Invoice Date) → forward-fill party name
  - Party sub-total (col0 startswith "Total ") → skip (don't emit)
  - Grand total (col0.strip() == "Total")  → capture for reconciliation; skip
  - Trailer (after grand total: %, FX notes, blanks) → skip silently
  - Invoice row (Invoice Date populated, Invoice Number populated) → emit OK
  - Credit-note row (Invoice Date populated, Invoice Number empty) → PARSE_ERROR
  - Unclassifiable → PARSE_ERROR

Guardrails (spec §15 + CLAUDE.md):
- Never use Due Date / overdue_days for any computation (raw_row_json only).
- No datetime.today() / datetime.now().
- No print statements.
- No DB writes.
"""

from __future__ import annotations

import contextlib
import io
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import pandas as pd
import structlog

from app.parsers.common import (
    ParseError,
    ParseResult,
    ParseStatus,
    StagedInvoice,
    compute_file_sha256,
    is_empty_cell,
    stringify_cell,
)

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Sheet / structural constants
# ---------------------------------------------------------------------------

_SHEET_NAME = "Aged Receivables Detail"
_HEADER_ROW_IDX = 5  # 0-indexed; row 5 contains column names
_DATA_START_ROW = 6  # first data row (after blank row 6)

# Column names expected in the header row (spec §4.2 rule 2).
# The parser indexes by name so column order changes don't break it.
_COL_CONTACT_ACCOUNT_NUMBER = "Contact Account Number"
_COL_PRIMARY_PERSON = "Primary Person"
_COL_INVOICE_DATE = "Invoice Date"
_COL_INVOICE_NUMBER = "Invoice Number"
_COL_INVOICE_REFERENCE = "Invoice Reference"
_COL_TOTAL = "Total"
_COL_INVOICE_SEEN = "Invoice Seen"
_COL_INVOICE_SENT = "Invoice Sent"
_COL_PROJECT_ID = "PROJECT ID"
_COL_SERVICE_MONTH = "SERVICE MONTH"
_COL_EMAIL = "Email"

# The 6 xero_metadata keys (spec §4.2 rule 6).
_XERO_META_KEYS: list[tuple[str, str]] = [
    ("invoice_seen", _COL_INVOICE_SEEN),
    ("invoice_sent", _COL_INVOICE_SENT),
    ("project_id", _COL_PROJECT_ID),
    ("service_month", _COL_SERVICE_MONTH),
    ("primary_person", _COL_PRIMARY_PERSON),
    ("email", _COL_EMAIL),
]

# As-of date regex: "As at DD Month YYYY" (case-insensitive, extra whitespace ok)
_AS_OF_DATE_RE = re.compile(
    r"as\s+at\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
    re.IGNORECASE,
)

# Invoice-seen high threshold (spec §4.2 rule 8): warn when > 20% of OK invoices are "Not seen".
_INVOICE_SEEN_HIGH_THRESHOLD: float = 0.20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_col_map(df: pd.DataFrame) -> dict[str, int]:
    """Build a column-name → column-index map from the header row (row 5).

    Only includes columns with a non-empty string header; the unnamed column
    (col 16 in the real fixture) is silently excluded.
    """
    header_row = df.iloc[_HEADER_ROW_IDX]
    col_map: dict[str, int] = {}
    for idx, val in enumerate(header_row):
        if isinstance(val, str) and val.strip():
            col_map[val.strip()] = idx
    return col_map


def _sniff_as_of_date(df: pd.DataFrame) -> date | None:
    """Parse the as-of date from row 2 (0-indexed).

    Returns ``date`` on success, ``None`` on sniff failure (triggers a
    non-blocking warning in the caller — spec §4.2 rule 1).
    """
    try:
        cell_val = df.iloc[2, 0]
        if is_empty_cell(cell_val):
            return None
        text = str(cell_val).strip()
        m = _AS_OF_DATE_RE.search(text)
        if not m:
            return None
        date_str = m.group(1)
        parsed_ts: date = pd.to_datetime(date_str, format="%d %B %Y").date()
        return parsed_ts
    except Exception:
        return None


def _row_to_raw_json(
    row: pd.Series[Any],
    col_names: list[str],
    col_name_to_idx: dict[str, int],
) -> dict[str, str | None]:
    """Stringify all named columns to produce a JSON-safe dict (spec §4.2 rule 5).

    Uses the ordered list of column names derived from the header row so every
    column (including Due Date, unnamed FX column, etc.) is captured exactly once.
    Accesses cells by integer index (row.iloc[i]) because the DataFrame uses
    integer positional indices, not column-name indices.
    """
    return {col: stringify_cell(row.iloc[col_name_to_idx[col]]) for col in col_names}


def _parse_date(val: Any) -> date | None:
    """Parse a cell value to ``datetime.date``.

    Returns ``None`` if ``val`` is empty.  Raises ``ValueError`` with a
    descriptive message if the value is present but unparseable.
    Mirrors the Task 2 Tally implementation exactly.
    """
    if is_empty_cell(val):
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    # pandas Timestamp (comes from openpyxl for datetime cells)
    if hasattr(val, "date") and callable(val.date):
        result: date = val.date()
        return result
    # Fallback: try parsing string
    try:
        parsed: date = pd.to_datetime(str(val)).date()
        return parsed
    except Exception as exc:
        raise ValueError(f"Cannot parse date from {val!r}: {exc}") from exc


def _build_xero_metadata(
    row: pd.Series[Any],
    col_map: dict[str, int],
) -> dict[str, str | None]:
    """Extract the 6 xero_metadata fields from the row (spec §4.2 rule 6).

    Missing column (not in col_map) → value ``None``.
    All values stringified via ``stringify_cell`` so they are JSON-safe.
    Accesses cells via row.iloc[idx] because the DataFrame uses integer positional indices.
    """
    meta: dict[str, str | None] = {}
    for meta_key, col_name in _XERO_META_KEYS:
        if col_name in col_map:
            meta[meta_key] = stringify_cell(row.iloc[col_map[col_name]])
        else:
            meta[meta_key] = None
    return meta


# ---------------------------------------------------------------------------
# Row-classification predicates
# ---------------------------------------------------------------------------


def _is_blank_row(row: pd.Series[Any], col_name_to_idx: dict[str, int]) -> bool:
    """All named columns are empty."""
    return all(is_empty_cell(row.iloc[idx]) for idx in col_name_to_idx.values())


def _is_party_subtotal(row: pd.Series[Any], contact_col: int) -> bool:
    """col0.startswith("Total ") — party sub-total row."""
    val = row.iloc[contact_col]
    return isinstance(val, str) and val.startswith("Total ")


def _is_grand_total(row: pd.Series[Any], contact_col: int) -> bool:
    """col0.strip() == "Total" — the single grand total row."""
    val = row.iloc[contact_col]
    return isinstance(val, str) and val.strip() == "Total"


def _is_party_header(row: pd.Series[Any], contact_col: int, inv_date_col: int | None) -> bool:
    """col0 (Contact Account Number) populated, Invoice Date empty.

    Party headers have only col0 populated in the real fixture; they always
    lack an Invoice Date, which is the key discriminator from invoice rows.
    Subtotal/grand-total detection is done before calling this predicate so
    it need not re-check for "Total"-prefixed strings.
    """
    col0_val = row.iloc[contact_col]
    if is_empty_cell(col0_val):
        return False
    # Must NOT be a sub-total / grand-total string (caller checks this first,
    # but guard here for clarity).
    if isinstance(col0_val, str) and col0_val.strip().startswith("Total"):
        return False
    # Invoice Date must be absent.
    if inv_date_col is None:
        return True
    return is_empty_cell(row.iloc[inv_date_col])


def _is_invoice_row(row: pd.Series[Any], inv_date_col: int | None, inv_num_col: int | None) -> bool:
    """Invoice Date present AND Invoice Number present."""
    if inv_date_col is None or inv_num_col is None:
        return False
    return not is_empty_cell(row.iloc[inv_date_col]) and not is_empty_cell(row.iloc[inv_num_col])


def _is_credit_note_row(
    row: pd.Series[Any], inv_date_col: int | None, inv_num_col: int | None
) -> bool:
    """Invoice Date present BUT Invoice Number absent — credit note / adjustment."""
    if inv_date_col is None or inv_num_col is None:
        return False
    return not is_empty_cell(row.iloc[inv_date_col]) and is_empty_cell(row.iloc[inv_num_col])


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------


def parse_xero_aged_receivables(file_bytes: bytes) -> ParseResult:  # noqa: PLR0912,PLR0915
    """Parse a Xero Aged Receivables Detail XLSX file and return a ``ParseResult``.

    Args:
        file_bytes: Raw bytes of the ``.xlsx`` file (from HTTP upload or disk).

    Returns:
        ``ParseResult`` with ``source_hint="XERO"``, ``credit_periods=[]``,
        ``as_of_date`` sniffed from row 2.  ``is_valid`` is ``True`` iff
        ``errors`` is empty (warnings are non-blocking per ADR-0004).
    """
    sha256 = compute_file_sha256(file_bytes)

    invoices: list[StagedInvoice] = []
    errors: list[ParseError] = []
    warnings: list[ParseError] = []

    # ------------------------------------------------------------------ #
    # 1. Load sheet                                                        #
    # ------------------------------------------------------------------ #
    try:
        df = pd.read_excel(
            io.BytesIO(file_bytes),
            sheet_name=_SHEET_NAME,
            header=None,
            dtype=object,  # keep everything as-is; we do our own coercion
        )
    except Exception as exc:
        errors.append(
            ParseError(
                row_index=-1,
                code="SHEET_NOT_FOUND",
                message=f"Cannot open sheet '{_SHEET_NAME}': {exc}",
            )
        )
        return ParseResult(
            file_sha256=sha256,
            source_hint="XERO",
            errors=errors,
        )

    # ------------------------------------------------------------------ #
    # 2. Sniff as-of date from row 2 (spec §4.2 rule 1)                  #
    # ------------------------------------------------------------------ #
    as_of_date = _sniff_as_of_date(df)
    if as_of_date is None:
        warnings.append(
            ParseError(
                row_index=2,
                code="AS_OF_DATE_SNIFF_FAILED",
                message="Could not parse 'As at DD Month YYYY' from row 2 of the Xero sheet.",
            )
        )

    # ------------------------------------------------------------------ #
    # 3. Build column-name → index map from header row 5                 #
    # ------------------------------------------------------------------ #
    if len(df) <= _HEADER_ROW_IDX:
        errors.append(
            ParseError(
                row_index=-1,
                code="UNEXPECTED_SHAPE",
                message=(
                    f"Sheet has only {len(df)} rows; expected at least "
                    f"{_HEADER_ROW_IDX + 1} (header on row {_HEADER_ROW_IDX})."
                ),
            )
        )
        return ParseResult(
            file_sha256=sha256,
            source_hint="XERO",
            errors=errors,
            warnings=warnings,
            as_of_date=as_of_date,
        )

    col_map = _build_col_map(df)

    # Derive ordered list of column names for raw_row_json (all named cols).
    col_names_ordered: list[str] = [
        str(v).strip() for v in df.iloc[_HEADER_ROW_IDX] if isinstance(v, str) and v.strip()
    ]
    # col_map maps name → int index (same mapping used for both predicates and raw_row_json).

    # Resolve required column indices (None if not found in header).
    contact_col: int = col_map.get(_COL_CONTACT_ACCOUNT_NUMBER, 0)
    inv_date_col: int | None = col_map.get(_COL_INVOICE_DATE)
    inv_num_col: int | None = col_map.get(_COL_INVOICE_NUMBER)
    total_col: int | None = col_map.get(_COL_TOTAL)

    log.info(
        "xero_parser.loaded_sheet",
        sheet=_SHEET_NAME,
        total_rows=len(df),
        col_count=len(col_map),
    )

    # ------------------------------------------------------------------ #
    # 4. Scan for grand total row index first so we can stop iteration   #
    # ------------------------------------------------------------------ #
    grand_total_row_idx: int | None = None
    grand_total_value: Decimal | None = None

    for scan_idx in range(_DATA_START_ROW, len(df)):
        scan_row = df.iloc[scan_idx]
        if _is_grand_total(scan_row, contact_col):
            grand_total_row_idx = scan_idx
            if total_col is not None:
                raw_gt = scan_row.iloc[total_col]
                if not is_empty_cell(raw_gt):
                    with contextlib.suppress(InvalidOperation):
                        grand_total_value = Decimal(str(raw_gt))
            break

    # ------------------------------------------------------------------ #
    # 5. Iterate data rows                                                 #
    # ------------------------------------------------------------------ #
    current_party: str | None = None
    past_grand_total = False

    for raw_idx in range(_DATA_START_ROW, len(df)):
        # Once past the grand total, skip all trailer rows silently.
        if past_grand_total:
            continue

        row = df.iloc[raw_idx]

        # Build raw_row_json from all named columns (every row gets it).
        raw_json: dict[str, str | None] = _row_to_raw_json(row, col_names_ordered, col_map)

        # -- Grand total row: capture (done in step 4), skip emission --
        if _is_grand_total(row, contact_col):
            past_grand_total = True
            continue

        # -- Blank row: skip silently --
        if _is_blank_row(row, col_map):
            continue

        # -- Party sub-total: skip emission --
        if _is_party_subtotal(row, contact_col):
            continue

        # -- Party header: forward-fill party name, skip emission --
        if _is_party_header(row, contact_col, inv_date_col):
            current_party = str(row.iloc[contact_col]).strip()
            continue

        # -- Invoice row (Invoice Date + Invoice Number both present) --
        if _is_invoice_row(row, inv_date_col, inv_num_col):
            party_raw = current_party if current_party is not None else ""

            # Parse Invoice Date.
            parsed_date: date | None = None
            date_parse_error: str | None = None
            try:
                assert inv_date_col is not None
                parsed_date = _parse_date(row.iloc[inv_date_col])
            except (ValueError, AssertionError) as exc:
                date_parse_error = str(exc)

            # Parse Total.
            parsed_amount: Decimal | None = None
            amount_parse_error: str | None = None
            if total_col is None:
                amount_parse_error = "Total column not found in header"
            else:
                raw_total = row.iloc[total_col]
                if is_empty_cell(raw_total):
                    amount_parse_error = f"Total is empty at row {raw_idx}"
                else:
                    try:
                        parsed_amount = Decimal(str(raw_total))
                    except InvalidOperation:
                        amount_parse_error = (
                            f"Cannot parse Total {raw_total!r} as Decimal at row {raw_idx}"
                        )

            if date_parse_error or amount_parse_error or parsed_date is None:
                reason_parts: list[str] = []
                if date_parse_error:
                    reason_parts.append(date_parse_error)
                elif parsed_date is None:
                    reason_parts.append(f"Invoice Date is empty at row {raw_idx}")
                if amount_parse_error:
                    reason_parts.append(amount_parse_error)
                reason = "; ".join(reason_parts) or "Unknown parse error"

                invoices.append(
                    StagedInvoice(
                        row_index=raw_idx,
                        status=ParseStatus.PARSE_ERROR,
                        source_currency="AED",
                        party_name_raw=party_raw,
                        invoice_ref=None,
                        invoice_date=None,
                        amount=None,
                        raw_row_json=raw_json,
                        parse_error_reason=reason,
                    )
                )
                continue

            # Invoice Number: already confirmed non-empty by _is_invoice_row.
            assert inv_num_col is not None
            invoice_ref = str(row.iloc[inv_num_col]).strip()

            # xero_metadata (spec §4.2 rule 6).
            xero_meta = _build_xero_metadata(row, col_map)

            invoices.append(
                StagedInvoice(
                    row_index=raw_idx,
                    status=ParseStatus.OK,
                    source_currency="AED",
                    party_name_raw=party_raw,
                    invoice_ref=invoice_ref,
                    invoice_date=parsed_date,
                    amount=parsed_amount,
                    raw_row_json=raw_json,
                    xero_metadata=xero_meta,
                )
            )
            continue

        # -- Credit note row (Invoice Date present, Invoice Number absent) --
        if _is_credit_note_row(row, inv_date_col, inv_num_col):
            party_raw = current_party if current_party is not None else ""
            invoices.append(
                StagedInvoice(
                    row_index=raw_idx,
                    status=ParseStatus.PARSE_ERROR,
                    source_currency="AED",
                    party_name_raw=party_raw,
                    invoice_ref=None,
                    invoice_date=None,
                    amount=None,
                    raw_row_json=raw_json,
                    parse_error_reason="no invoice number (credit note / adjustment)",
                )
            )
            continue

        # -- Unclassifiable row: emit PARSE_ERROR (spec §4.2 rule 9) --
        invoices.append(
            StagedInvoice(
                row_index=raw_idx,
                status=ParseStatus.PARSE_ERROR,
                source_currency="AED",
                party_name_raw=current_party or "",
                invoice_ref=None,
                invoice_date=None,
                amount=None,
                raw_row_json=raw_json,
                parse_error_reason=(
                    f"Row {raw_idx} has unexpected shape: not invoice, "
                    "party header, sub-total, grand total, credit note, or blank."
                ),
            )
        )

    # ------------------------------------------------------------------ #
    # 6. Grand total reconciliation (ADR-0004 — warning, non-blocking)   #
    # ------------------------------------------------------------------ #
    ok_invoices = [inv for inv in invoices if inv.status == ParseStatus.OK]
    sum_of_invoice_totals = sum(
        (inv.amount for inv in ok_invoices if inv.amount is not None),
        Decimal("0"),
    )

    if grand_total_value is not None:
        delta = abs(sum_of_invoice_totals - grand_total_value)
        if delta > Decimal("1"):
            warnings.append(
                ParseError(
                    row_index=grand_total_row_idx if grand_total_row_idx is not None else -1,
                    code="GRAND_TOTAL_MISMATCH",
                    message=(
                        f"Sum of invoice totals ({sum_of_invoice_totals}) "
                        f"differs from grand total ({grand_total_value}) "
                        f"by {delta} (> AED 1 tolerance; expected for Xero overdue-only total)"
                    ),
                    detail={
                        "sum_of_invoices": str(sum_of_invoice_totals),
                        "grand_total": str(grand_total_value),
                        "delta": str(delta),
                    },
                )
            )

    # ------------------------------------------------------------------ #
    # 7. INVOICE_SEEN_HIGH warning (spec §4.2 rule 8)                    #
    # ------------------------------------------------------------------ #
    if ok_invoices:
        not_seen_count = sum(
            1
            for inv in ok_invoices
            if (
                inv.xero_metadata is not None
                and inv.xero_metadata.get("invoice_seen") == "Not seen"
            )
        )
        pct = not_seen_count / len(ok_invoices)
        if pct > _INVOICE_SEEN_HIGH_THRESHOLD:
            warnings.append(
                ParseError(
                    row_index=-1,
                    code="INVOICE_SEEN_HIGH",
                    message=(
                        f"{not_seen_count} of {len(ok_invoices)} OK invoices "
                        f"({pct:.1%}) have Invoice Seen = 'Not seen' (threshold 20%)"
                    ),
                    detail={
                        "not_seen_count": not_seen_count,
                        "total": len(ok_invoices),
                        "percentage": pct,
                    },
                )
            )

    log.info(
        "xero_parser.completed",
        total_invoices=len(invoices),
        ok_invoices=len(ok_invoices),
        parse_errors=sum(1 for i in invoices if i.status == ParseStatus.PARSE_ERROR),
        errors=len(errors),
        warnings=len(warnings),
    )

    return ParseResult(
        invoices=invoices,
        credit_periods=[],
        errors=errors,
        warnings=warnings,
        as_of_date=as_of_date,
        file_sha256=sha256,
        source_hint="XERO",
    )
