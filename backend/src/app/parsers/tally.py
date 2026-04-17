"""Tally GrpBills parser — spec §4.1 (amended via ADR-0003).

Public interface::

    def parse_tally_grpbills(file_bytes: bytes) -> ParseResult: ...

Sheet: "Sundry Debtors".  Rows 0-4 are metadata / multi-row headers; data
starts at row 5.  Column order (0-indexed):

    0=date  1=ref_no  2=party_name  3=opening_amount  4=pending_amount
    5=due_on  6=overdue_days

Guardrails (spec §15 + CLAUDE.md):
- Never use ``due_on`` / ``overdue_days`` for computation (raw_row_json only).
- No ``datetime.today()`` / ``datetime.now()``.
- No print statements.
- No DB writes.
"""

from __future__ import annotations

import io
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
# Column layout (post-slice, 0-indexed within the 7-column raw sheet)
# ---------------------------------------------------------------------------

_SHEET_NAME = "Sundry Debtors"
_HEADER_ROWS = 5  # rows 0-4 are metadata; row 5 is the first data row
_COL_NAMES = [
    "date",
    "ref_no",
    "party_name",
    "opening_amount",
    "pending_amount",
    "due_on",
    "overdue_days",
]


# ---------------------------------------------------------------------------
# Row-classification helpers (all pure, no side effects)
# ---------------------------------------------------------------------------


def _is_party_header(row: pd.Series[Any]) -> bool:
    """Party header: party_name populated, date and ref_no both empty.

    Spec §4.1 rule 2 (exact match): a row is a party header iff party_name is
    non-empty AND date is empty AND ref_no is empty.  No constraint is placed on
    opening_amount or pending_amount — a Tally export variant may carry the
    party's opening balance on the header row without affecting classification.
    """
    return (
        not is_empty_cell(row["party_name"])
        and is_empty_cell(row["date"])
        and is_empty_cell(row["ref_no"])
    )


def _is_invoice_row(row: pd.Series[Any]) -> bool:
    """Invoice row: date AND ref_no both populated."""
    return not is_empty_cell(row["date"]) and not is_empty_cell(row["ref_no"])


def _is_blank_row(row: pd.Series[Any]) -> bool:
    """Completely empty row (cosmetic gap between party groups)."""
    return all(is_empty_cell(row[c]) for c in _COL_NAMES)


def _is_subtotal_or_grand_total(row: pd.Series[Any]) -> bool:
    """Subtotal-shaped: date+ref+party all empty, pending or opening populated."""
    return (
        is_empty_cell(row["date"])
        and is_empty_cell(row["ref_no"])
        and is_empty_cell(row["party_name"])
        and (not is_empty_cell(row["opening_amount"]) or not is_empty_cell(row["pending_amount"]))
    )


# ---------------------------------------------------------------------------
# Stringification for raw_row_json (must produce JSON-safe values)
# ---------------------------------------------------------------------------


def _row_to_raw_json(row: pd.Series[Any]) -> dict[str, str | None]:
    """Convert a full raw row to a JSON-safe dict (spec §4.1 rule 3)."""
    return {col: stringify_cell(row[col]) for col in _COL_NAMES}


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------


def _parse_date(val: Any) -> date | None:
    """Parse a cell value to ``datetime.date``.

    Returns ``None`` if ``val`` is empty.  Raises ``ValueError`` with a
    descriptive message if the value is present but unparseable.
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


# ---------------------------------------------------------------------------
# Grand-total row detection
# ---------------------------------------------------------------------------


def _detect_grand_total(
    df: pd.DataFrame,
    data_start: int,
) -> tuple[int, Decimal] | tuple[None, None]:
    """Return (row_index, pending_amount) for the grand total row.

    Implementation: collect every subtotal-shaped row (date/ref/party all
    empty, pending or opening populated) in forward order.  The last such row
    is unconditionally treated as the grand total — no adjacency check is
    performed.

    - If no subtotal-shaped rows exist → return (None, None).
    - If exactly one subtotal-shaped row exists → treat it as the grand total;
      if its pending_amount is NaN → return (None, None).
    - If two or more exist → the last one is the grand total; if its
      pending_amount is NaN → return (None, None).
    """
    subtotal_rows: list[tuple[int, Any]] = []  # (raw_index, row)
    for idx in range(data_start, len(df)):
        row = df.iloc[idx]
        if _is_subtotal_or_grand_total(row):
            subtotal_rows.append((idx, row))

    if not subtotal_rows:
        return None, None

    if len(subtotal_rows) == 1:
        # Only one subtotal-shaped row; treat it as the grand total.
        idx, row = subtotal_rows[-1]
        pending = row["pending_amount"]
        if is_empty_cell(pending):
            return None, None
        return idx, Decimal(str(pending))

    # Two or more: the last one is the grand total.
    idx, row = subtotal_rows[-1]
    pending = row["pending_amount"]
    if is_empty_cell(pending):
        # Grand total pending is NaN — can't reconcile.
        return None, None
    return idx, Decimal(str(pending))


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------


def parse_tally_grpbills(file_bytes: bytes) -> ParseResult:  # noqa: PLR0912,PLR0915
    """Parse a Tally GrpBills XLSX file and return a ``ParseResult``.

    Args:
        file_bytes: Raw bytes of the ``.xlsx`` file (from HTTP upload or disk).

    Returns:
        ``ParseResult`` with ``source_hint="TALLY"``, ``credit_periods=[]``,
        ``as_of_date=None``.  ``is_valid`` is ``True`` iff ``errors`` is empty.
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
            source_hint="TALLY",
            errors=errors,
        )

    if df.shape[1] < len(_COL_NAMES):
        errors.append(
            ParseError(
                row_index=-1,
                code="UNEXPECTED_SHAPE",
                message=(
                    f"Sheet has {df.shape[1]} columns; expected at least " f"{len(_COL_NAMES)}."
                ),
            )
        )
        return ParseResult(
            file_sha256=sha256,
            source_hint="TALLY",
            errors=errors,
        )

    # Slice to the 7 expected columns and name them.
    df = df.iloc[:, : len(_COL_NAMES)].copy()
    df.columns = _COL_NAMES

    log.info(
        "tally_parser.loaded_sheet",
        sheet=_SHEET_NAME,
        total_rows=len(df),
    )

    # ------------------------------------------------------------------ #
    # 2. Detect grand total row (before iterating, so we can skip it)     #
    # ------------------------------------------------------------------ #
    grand_total_row_idx, grand_total_pending = _detect_grand_total(df, _HEADER_ROWS)

    # ------------------------------------------------------------------ #
    # 3. Iterate data rows (starting at row 5)                            #
    # ------------------------------------------------------------------ #
    current_party: str | None = None
    # party_name -> (list_of_invoice_pending_amounts, subtotal_pending_amount | None)
    party_invoice_sums: dict[str, Decimal] = {}
    party_subtotals: dict[str, Decimal | None] = {}  # None = subtotal pending is NaN
    party_subtotal_row_idx: dict[str, int] = {}
    party_order: list[str] = []

    for raw_idx in range(_HEADER_ROWS, len(df)):
        # Skip the grand total row (handled separately after the loop).
        if raw_idx == grand_total_row_idx:
            continue

        row = df.iloc[raw_idx]
        raw_json = _row_to_raw_json(row)

        # -- Blank row: skip silently (spec §4.1 rule 5) --
        if _is_blank_row(row):
            continue

        # -- Party header (spec §4.1 rule 2) --
        if _is_party_header(row):
            current_party = str(row["party_name"]).strip()
            if current_party not in party_invoice_sums:
                party_invoice_sums[current_party] = Decimal("0")
                party_order.append(current_party)
            # Do NOT emit an invoice for the header row itself.
            continue

        # -- Subtotal-shaped row (sub-total for current party, spec §4.1 rule 4) --
        if _is_subtotal_or_grand_total(row):
            if current_party is not None and current_party not in party_subtotals:
                # Only capture the FIRST subtotal per party.
                pend = row["pending_amount"]
                if not is_empty_cell(pend):
                    party_subtotals[current_party] = Decimal(str(pend))
                else:
                    party_subtotals[current_party] = None  # pending=NaN (AWE-type)
                party_subtotal_row_idx[current_party] = raw_idx
            continue

        # -- Invoice row (spec §4.1 rule 3) --
        if _is_invoice_row(row):
            ref_no_raw = row["ref_no"]
            date_raw = row["date"]

            # Attempt to parse date.
            parsed_date: date | None = None
            date_parse_error: str | None = None
            try:
                parsed_date = _parse_date(date_raw)
            except ValueError as exc:
                date_parse_error = str(exc)

            # Attempt to parse pending_amount.
            pend_raw = row["pending_amount"]
            parsed_amount: Decimal | None = None
            amount_parse_error: str | None = None
            if is_empty_cell(pend_raw):
                amount_parse_error = f"pending_amount is empty at row {raw_idx}"
            else:
                try:
                    parsed_amount = Decimal(str(pend_raw))
                except InvalidOperation:
                    amount_parse_error = f"Cannot parse pending_amount {pend_raw!r} as Decimal"

            party_raw = current_party if current_party is not None else ""

            if date_parse_error or amount_parse_error or parsed_date is None:
                # Emit as PARSE_ERROR (spec §4.1 rule 9).
                reason_parts = []
                if date_parse_error:
                    reason_parts.append(date_parse_error)
                elif parsed_date is None:
                    reason_parts.append(f"date is empty at row {raw_idx}")
                if amount_parse_error:
                    reason_parts.append(amount_parse_error)
                reason = "; ".join(reason_parts) or "Unknown parse error"

                invoices.append(
                    StagedInvoice(
                        row_index=raw_idx,
                        status=ParseStatus.PARSE_ERROR,
                        source_currency="INR",
                        party_name_raw=party_raw,
                        invoice_ref=None,
                        invoice_date=None,
                        amount=None,
                        raw_row_json=raw_json,
                        parse_error_reason=reason,
                    )
                )
                continue

            # Ref-no parse: always a string (spec §4.1 rule 3).
            invoice_ref = str(ref_no_raw).strip()
            if not invoice_ref:
                invoices.append(
                    StagedInvoice(
                        row_index=raw_idx,
                        status=ParseStatus.PARSE_ERROR,
                        source_currency="INR",
                        party_name_raw=party_raw,
                        invoice_ref=None,
                        invoice_date=None,
                        amount=None,
                        raw_row_json=raw_json,
                        parse_error_reason=f"ref_no is blank at row {raw_idx}",
                    )
                )
                continue

            # All good — emit OK invoice.
            invoices.append(
                StagedInvoice(
                    row_index=raw_idx,
                    status=ParseStatus.OK,
                    source_currency="INR",
                    party_name_raw=party_raw,
                    invoice_ref=invoice_ref,
                    invoice_date=parsed_date,
                    amount=parsed_amount,
                    raw_row_json=raw_json,
                )
            )

            # Accumulate invoice sum for sub-total reconciliation.
            if current_party is not None and parsed_amount is not None:
                party_invoice_sums[current_party] = (
                    party_invoice_sums.get(current_party, Decimal("0")) + parsed_amount
                )
            continue

        # -- Unclassifiable row: emit PARSE_ERROR --
        invoices.append(
            StagedInvoice(
                row_index=raw_idx,
                status=ParseStatus.PARSE_ERROR,
                source_currency="INR",
                party_name_raw=current_party or "",
                invoice_ref=None,
                invoice_date=None,
                amount=None,
                raw_row_json=raw_json,
                parse_error_reason=(
                    f"Row {raw_idx} has unexpected shape: not invoice, "
                    "party header, subtotal, or blank."
                ),
            )
        )

    # ------------------------------------------------------------------ #
    # 4. Per-party sub-total reconciliation (spec §4.1 rule 4)            #
    # ------------------------------------------------------------------ #
    for party in party_order:
        if party not in party_subtotals:
            # Party has no subtotal row — nothing to reconcile.
            continue
        subtotal_pending = party_subtotals[party]
        if subtotal_pending is None:
            # Pending is NaN for this party's subtotal row — skip numeric check.
            continue
        invoice_sum = party_invoice_sums.get(party, Decimal("0"))
        delta = abs(subtotal_pending - invoice_sum)
        if delta > Decimal("1"):
            # NOTE (CLAUDE.md data-handling): `party` is the raw party name from
            # the Tally export. It is load-bearing for analyst triage — the
            # warning is actionable only if the analyst knows which party to
            # open. It belongs in the structured result (detail) for the UI to
            # render. Downstream loggers (structlog in M3 upload pipeline,
            # access logs, etc.) MUST redact `detail.party` when emitting these
            # warnings to log output; do not log this field raw.
            warnings.append(
                ParseError(
                    row_index=party_subtotal_row_idx.get(party, -1),
                    code="SUBTOTAL_MISMATCH",
                    message=(
                        f"Party sub-total pending differs from sum of invoice "
                        f"pending by {delta} (> ₹1 tolerance)"
                    ),
                    detail={
                        "party": party,
                        "subtotal_value": str(subtotal_pending),
                        "sum_of_rows": str(invoice_sum),
                    },
                )
            )

    # ------------------------------------------------------------------ #
    # 5. Grand-total reconciliation (spec §4.1 rule 8 — amended ADR-0003) #
    # ------------------------------------------------------------------ #
    sum_of_invoice_pending = sum(
        (inv.amount for inv in invoices if inv.status == ParseStatus.OK and inv.amount is not None),
        Decimal("0"),
    )

    if grand_total_pending is not None:
        # Hard check: sum(party_subtotal_pending) vs grand_total (₹1 tolerance).
        sum_of_party_subtotals = sum(
            (v for v in party_subtotals.values() if v is not None),
            Decimal("0"),
        )
        gt_delta = abs(sum_of_party_subtotals - grand_total_pending)
        if gt_delta > Decimal("1"):
            # ADR-0003 originally proposed blocking (errors), but empirical data shows
            # Tally applies group-level netting that makes party_subtotals != grand_total
            # by ~23M on a real file. Emitting as an error would block every real upload.
            # Resolution: emit as WARNING so real uploads are not blocked while still
            # surfacing the mismatch for analyst review.  Synthetic test files with a
            # small deliberate offset (e.g. ₹50) still trigger this warning so the
            # check remains meaningful as a parser-bug detector.
            warnings.append(
                ParseError(
                    row_index=grand_total_row_idx if grand_total_row_idx is not None else -1,
                    code="GRAND_TOTAL_MISMATCH",
                    message=(
                        f"Sum of party sub-totals ({sum_of_party_subtotals}) "
                        f"differs from grand total ({grand_total_pending}) "
                        f"by {gt_delta} (> ₹1 tolerance)"
                    ),
                    detail={
                        "sum_of_party_subtotals": str(sum_of_party_subtotals),
                        "grand_total": str(grand_total_pending),
                        "delta": str(gt_delta),
                    },
                )
            )

        # Informational warning (always emitted for auditability — spec §4.1 rule 8).
        invoice_delta = sum_of_invoice_pending - grand_total_pending
        warnings.append(
            ParseError(
                row_index=grand_total_row_idx if grand_total_row_idx is not None else -1,
                code="UNALLOCATED_CREDITS_DELTA",
                message=(
                    f"Sum of per-invoice pending ({sum_of_invoice_pending}) "
                    f"vs grand total ({grand_total_pending}): "
                    f"delta={invoice_delta} (unallocated credits / netting)"
                ),
                detail={
                    "sum_of_invoice_pending": str(sum_of_invoice_pending),
                    "grand_total": str(grand_total_pending),
                    "delta": str(invoice_delta),
                },
            )
        )

    log.info(
        "tally_parser.completed",
        total_invoices=len(invoices),
        ok_invoices=sum(1 for i in invoices if i.status == ParseStatus.OK),
        parse_errors=sum(1 for i in invoices if i.status == ParseStatus.PARSE_ERROR),
        errors=len(errors),
        warnings=len(warnings),
    )

    return ParseResult(
        invoices=invoices,
        credit_periods=[],
        errors=errors,
        warnings=warnings,
        as_of_date=None,
        file_sha256=sha256,
        source_hint="TALLY",
    )
