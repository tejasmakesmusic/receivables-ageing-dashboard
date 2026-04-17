"""Unit tests for app.parsers.credit_period (M2 Task 4).

Real-fixture tests skip gracefully when the fixture is absent from the
fixture directory (CI-safe: spec §12, plan open-decision #2).

Data-handling rule (CLAUDE.md §"Data handling"): no raw client names in
assertion messages.  All assertions are structural (counts, entity codes,
field presence).  Synthetic client names like "AlphaClient Ltd" are fine.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any

import openpyxl
import pytest

from app.parsers.common import StagedCreditPeriod
from app.parsers.credit_period import parse_credit_period_master

# ---------------------------------------------------------------------------
# Fixture path
# ---------------------------------------------------------------------------

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "sample_files"
    / "Credit Period for Accounts - India & UAE.xlsx"
)


@pytest.fixture
def credit_period_file_bytes() -> bytes:
    if not FIXTURE_PATH.exists():
        pytest.skip(f"fixture not present: {FIXTURE_PATH}")
    return FIXTURE_PATH.read_bytes()


# ---------------------------------------------------------------------------
# Synthetic XLSX builder
# ---------------------------------------------------------------------------
#
# Builds a minimal Credit Period master workbook in memory.
# India sheet: 2 cols (Client Name | Credit Period)
# UAE sheet:   4 cols (Client Name | Credit Period | Reason for extended Credit | Amount)
#
# D20: Amount column is present in the UAE sheet so the parser must DROP it.
# The builder always includes Amount to make the D20 test load-bearing.

_INDIA_HEADER = ["Client Name", "Credit Period"]
_UAE_HEADER = ["Client Name", "Credit Period", "Reason for extended Credit", "Amount"]


def _make_ind_row(name: str | None, credit_days: Any) -> list[Any]:
    return [name, credit_days]


def _make_uae_row(
    name: str,
    credit_days: Any,
    reason: str | None = None,
    amount: Any = None,
) -> list[Any]:
    return [name, credit_days, reason, amount]


def _build_wb_bytes(
    india_rows: list[list[Any]],
    uae_rows: list[list[Any]],
    include_india: bool = True,
    include_uae: bool = True,
) -> bytes:
    """Build a minimal Credit Period master XLSX in memory.

    Args:
        india_rows: Data rows for the India sheet (excluding header).
        uae_rows: Data rows for the UAE sheet (excluding header).
        include_india: If False, the India sheet is omitted entirely.
        include_uae: If False, the UAE sheet is omitted entirely.

    Returns:
        Raw bytes of the ``.xlsx`` file.
    """
    wb = openpyxl.Workbook()
    del wb["Sheet"]  # remove default sheet

    if include_india:
        ws_india = wb.create_sheet("India")
        ws_india.append(_INDIA_HEADER)
        for row in india_rows:
            ws_india.append(row)

    if include_uae:
        ws_uae = wb.create_sheet("UAE")
        ws_uae.append(_UAE_HEADER)
        for row in uae_rows:
            ws_uae.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Minimal valid synthetic fixture
# ---------------------------------------------------------------------------

_SIMPLE_IND_ROWS: list[list[Any]] = [
    _make_ind_row("AlphaClient Ltd", 30),
    _make_ind_row("BetaClient Inc", 0),
    _make_ind_row("GammaClient Co", 15),
]
_SIMPLE_UAE_ROWS: list[list[Any]] = [
    _make_uae_row("DeltaClient LLC", 30, "Long-term contract", 99999),
    _make_uae_row("EpsilonClient FZ", 0, None, None),
]


@pytest.fixture
def simple_cp_bytes() -> bytes:
    return _build_wb_bytes(_SIMPLE_IND_ROWS, _SIMPLE_UAE_ROWS)


# ---------------------------------------------------------------------------
# Test 1: source_hint and sha256 shape
# ---------------------------------------------------------------------------


def test_source_hint_credit_period_and_sha256_64_char_hex(simple_cp_bytes: bytes) -> None:
    result = parse_credit_period_master(simple_cp_bytes)
    assert result.source_hint == "CREDIT_PERIOD"
    assert len(result.file_sha256) == 64
    assert all(c in "0123456789abcdef" for c in result.file_sha256)


# ---------------------------------------------------------------------------
# Test 2: invoices == [] and as_of_date is None on all results
# ---------------------------------------------------------------------------


def test_invoices_empty_and_as_of_date_none(simple_cp_bytes: bytes) -> None:
    result = parse_credit_period_master(simple_cp_bytes)
    assert result.invoices == [], "Credit Period parser must never emit invoices"
    assert result.as_of_date is None, "as_of_date must always be None for Credit Period parser"


def test_invoices_empty_on_real_fixture(credit_period_file_bytes: bytes) -> None:
    result = parse_credit_period_master(credit_period_file_bytes)
    assert result.invoices == []
    assert result.as_of_date is None


# ---------------------------------------------------------------------------
# Test 3: real fixture — structural parse (fixture has data quality issues)
#
# Fixture inspection 2026-04-17 revealed real data quality issues:
#   - India sheet: 3 duplicate client names → DUPLICATE_CLIENT → is_valid False
#   - UAE sheet:   2 duplicate client names + 7 empty credit_days → errors
#
# The parser correctly flags these as errors per spec §4.3 rule 5.
# The fixture would need cleansing before re-upload; that is the analyst's job.
# We assert the structural parser behaviour (error codes present, correct counts)
# rather than asserting is_valid=True (which is incorrect for this fixture).
# ---------------------------------------------------------------------------


def test_real_fixture_parser_runs_and_emits_expected_error_codes(
    credit_period_file_bytes: bytes,
) -> None:
    """Real fixture parses without exception; expected error codes are present.

    Fixture inspection 2026-04-17:
      - India: 3 duplicate names → DUPLICATE_CLIENT
      - UAE: 2 duplicate groups → DUPLICATE_CLIENT
      - UAE: 7 rows with empty credit_days → INVALID_CREDIT_DAYS
    """
    result = parse_credit_period_master(credit_period_file_bytes)
    # Parser must complete without exception (structural integrity).
    assert result.source_hint == "CREDIT_PERIOD"
    assert result.file_sha256, "file_sha256 must be set"

    error_codes = {e.code for e in result.errors}
    # Both sheets have duplicate issues → DUPLICATE_CLIENT must appear.
    assert "DUPLICATE_CLIENT" in error_codes, (
        f"Expected DUPLICATE_CLIENT in errors on real fixture. "
        f"errors={[e.code for e in result.errors]}"
    )
    # UAE sheet has empty credit_days rows → INVALID_CREDIT_DAYS must appear.
    assert "INVALID_CREDIT_DAYS" in error_codes, (
        f"Expected INVALID_CREDIT_DAYS in errors on real fixture. "
        f"errors={[e.code for e in result.errors]}"
    )
    # is_valid must be False (errors present).
    assert (
        result.is_valid is False
    ), "Real fixture has known data quality issues; is_valid must be False."


# ---------------------------------------------------------------------------
# Test 4: real fixture — exact error counts from fixture inspection 2026-04-17
# ---------------------------------------------------------------------------


def test_real_fixture_exact_error_counts(credit_period_file_bytes: bytes) -> None:
    """Exact error counts verified by fixture inspection on 2026-04-17.

    India: 1 DUPLICATE_CLIENT error (3 dupe names in one error record).
    UAE:   1 DUPLICATE_CLIENT error (2 dupe names) + 7 INVALID_CREDIT_DAYS errors.
    Total errors: 9.

    If the fixture is replaced or cleansed, re-measure and update.
    """
    result = parse_credit_period_master(credit_period_file_bytes)
    dup_errs = [e for e in result.errors if e.code == "DUPLICATE_CLIENT"]
    invalid_errs = [e for e in result.errors if e.code == "INVALID_CREDIT_DAYS"]

    # 1 DUPLICATE_CLIENT per sheet that has dupes (India + UAE = 2 total).
    assert (
        len(dup_errs) == 2
    ), f"Expected 2 DUPLICATE_CLIENT errors on real fixture; got {len(dup_errs)}."
    # 7 rows with empty credit_days in UAE.
    assert (
        len(invalid_errs) == 7
    ), f"Expected 7 INVALID_CREDIT_DAYS errors on real fixture; got {len(invalid_errs)}."


# ---------------------------------------------------------------------------
# Test 5: entity_code invariants — IND has reason_note=None, UAE has entity_code="UAE"
# ---------------------------------------------------------------------------


def test_entity_code_invariants(simple_cp_bytes: bytes) -> None:
    result = parse_credit_period_master(simple_cp_bytes)
    for cp in result.credit_periods:
        if cp.entity_code == "IND":
            assert (
                cp.reason_note is None
            ), f"IND StagedCreditPeriod at row {cp.row_index} must have reason_note=None"
        else:
            assert (
                cp.entity_code == "UAE"
            ), f"entity_code must be 'IND' or 'UAE'; got {cp.entity_code!r}"


def test_entity_code_invariants_real_fixture(credit_period_file_bytes: bytes) -> None:
    result = parse_credit_period_master(credit_period_file_bytes)
    for cp in result.credit_periods:
        assert cp.entity_code in (
            "IND",
            "UAE",
        ), f"Unexpected entity_code {cp.entity_code!r} at row {cp.row_index}"
        if cp.entity_code == "IND":
            assert cp.reason_note is None, f"IND row {cp.row_index} must have reason_note=None"


# ---------------------------------------------------------------------------
# Test 6: D20 — Amount column NEVER reaches any StagedCreditPeriod
# ---------------------------------------------------------------------------


def test_d20_amount_not_in_model_fields() -> None:
    """StagedCreditPeriod.model_fields must not contain 'amount' or any Amount variant."""
    field_names = set(StagedCreditPeriod.model_fields.keys())
    for bad in ("amount", "Amount", "amount_col", "uae_amount"):
        assert (
            bad not in field_names
        ), f"D20 violation: StagedCreditPeriod.model_fields contains {bad!r}"


def test_d20_amount_value_not_in_parsed_output() -> None:
    """Synthetic UAE row with Amount=99999 — that value must NOT appear anywhere in output.

    This test is load-bearing for D20 compliance: if the Amount column leaks
    into any field, model_dump(), or ParseError.detail, the sentinel value
    '99999' will appear in the JSON dump and this test will catch it.
    """
    sentinel = "99999"
    rows_with_sentinel: list[list[Any]] = [
        _make_uae_row("AlphaClient Ltd", 30, "Extended", 99999),
        _make_uae_row("BetaClient Ltd", 0, None, 99999),
    ]
    file_bytes = _build_wb_bytes(
        india_rows=[_make_ind_row("IndClient Ltd", 30)],
        uae_rows=rows_with_sentinel,
    )
    result = parse_credit_period_master(file_bytes)

    # Check every StagedCreditPeriod for the sentinel.
    for cp in result.credit_periods:
        dumped = json.dumps(cp.model_dump())
        assert sentinel not in dumped, (
            f"D20 violation: sentinel value {sentinel!r} found in "
            f"StagedCreditPeriod.model_dump() at row {cp.row_index}: {dumped}"
        )

    # Check every ParseError.detail as well.
    for err in result.errors + result.warnings:
        if err.detail is not None:
            detail_json = json.dumps(err.detail)
            assert sentinel not in detail_json, (
                f"D20 violation: sentinel value {sentinel!r} found in "
                f"ParseError.detail (code={err.code}): {detail_json}"
            )


# ---------------------------------------------------------------------------
# Test 7: credit_days = 0 is valid
# ---------------------------------------------------------------------------


def test_credit_days_zero_is_valid() -> None:
    """credit_days=0 (immediate payment) must be emitted as a valid StagedCreditPeriod."""
    file_bytes = _build_wb_bytes(
        india_rows=[_make_ind_row("ZeroDayClient Ltd", 0)],
        uae_rows=[_make_uae_row("ZeroUaeClient LLC", 0)],
    )
    result = parse_credit_period_master(file_bytes)
    assert (
        result.is_valid is True
    ), f"credit_days=0 must be valid. errors={[e.code for e in result.errors]}"
    zero_day_rows = [cp for cp in result.credit_periods if cp.credit_days == 0]
    assert len(zero_day_rows) == 2, f"Expected 2 rows with credit_days=0; got {len(zero_day_rows)}"
    for cp in zero_day_rows:
        assert cp.credit_days == 0


# ---------------------------------------------------------------------------
# Test 8: credit_days = -5 → INVALID_CREDIT_DAYS in errors; is_valid False
# ---------------------------------------------------------------------------


def test_negative_credit_days_emits_invalid_error() -> None:
    """credit_days=-5 must emit INVALID_CREDIT_DAYS in errors; is_valid False."""
    file_bytes = _build_wb_bytes(
        india_rows=[_make_ind_row("NegativeClient Ltd", -5)],
        uae_rows=[_make_uae_row("ValidUaeClient LLC", 30)],
    )
    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is False, "Negative credit_days must make is_valid False"
    invalid_errs = [e for e in result.errors if e.code == "INVALID_CREDIT_DAYS"]
    assert invalid_errs, (
        f"Expected INVALID_CREDIT_DAYS in errors. " f"errors={[e.code for e in result.errors]}"
    )


# ---------------------------------------------------------------------------
# Test 9: credit_days = "not a number" → INVALID_CREDIT_DAYS; is_valid False
# ---------------------------------------------------------------------------


def test_non_numeric_credit_days_emits_invalid_error() -> None:
    """credit_days='not a number' must emit INVALID_CREDIT_DAYS in errors."""
    file_bytes = _build_wb_bytes(
        india_rows=[_make_ind_row("BadValueClient Ltd", "not a number")],
        uae_rows=[_make_uae_row("ValidUaeClient LLC", 30)],
    )
    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is False, "Unparseable credit_days must make is_valid False"
    invalid_errs = [e for e in result.errors if e.code == "INVALID_CREDIT_DAYS"]
    assert invalid_errs, (
        f"Expected INVALID_CREDIT_DAYS in errors. " f"errors={[e.code for e in result.errors]}"
    )
    # detail must include the sheet and value.
    err = invalid_errs[0]
    assert err.detail is not None
    assert "sheet" in err.detail


# ---------------------------------------------------------------------------
# Test 10: empty Client Name rows mixed with valid rows → empty rows skipped
# ---------------------------------------------------------------------------


def test_empty_client_name_rows_skipped() -> None:
    """Empty Client Name rows (blank separators) must be silently skipped.

    Valid rows around the empty rows must still be emitted.
    is_valid must be True (empty-name rows are not errors).
    """
    india_rows: list[list[Any]] = [
        _make_ind_row("ValidClientA Ltd", 30),
        _make_ind_row("", 0),  # empty string → skip
        _make_ind_row(None, 0),  # None → skip
        _make_ind_row("ValidClientB Inc", 15),
        _make_ind_row("   ", 0),  # whitespace-only → skip
        _make_ind_row("ValidClientC Co", 45),
    ]
    file_bytes = _build_wb_bytes(
        india_rows=india_rows,
        uae_rows=[_make_uae_row("ValidUaeClient LLC", 30)],
    )
    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is True, (
        f"Empty client name rows must not produce errors. "
        f"errors={[e.code for e in result.errors]}"
    )
    ind_rows = [cp for cp in result.credit_periods if cp.entity_code == "IND"]
    assert len(ind_rows) == 3, f"Expected 3 IND rows (empty rows skipped); got {len(ind_rows)}"


# ---------------------------------------------------------------------------
# Test 11: duplicate client names in IND sheet → DUPLICATE_CLIENT error
# ---------------------------------------------------------------------------


def test_duplicate_client_names_in_india_sheet_fails_parse() -> None:
    """'AlphaClient Ltd' appears twice in India sheet → DUPLICATE_CLIENT error."""
    india_rows: list[list[Any]] = [
        _make_ind_row("AlphaClient Ltd", 30),
        _make_ind_row("BetaClient Inc", 0),
        _make_ind_row("AlphaClient Ltd", 15),  # duplicate
    ]
    file_bytes = _build_wb_bytes(
        india_rows=india_rows,
        uae_rows=[_make_uae_row("ValidUaeClient LLC", 30)],
    )
    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is False, "Duplicate client in IND sheet must make is_valid False"

    dup_errs = [e for e in result.errors if e.code == "DUPLICATE_CLIENT"]
    assert dup_errs, (
        f"Expected DUPLICATE_CLIENT in errors. " f"errors={[e.code for e in result.errors]}"
    )
    err = dup_errs[0]
    assert err.detail is not None
    assert (
        err.detail.get("sheet") == "India"
    ), f"detail['sheet'] must be 'India'; got {err.detail.get('sheet')!r}"
    assert "AlphaClient Ltd" in err.detail.get(
        "duplicates", []
    ), "detail['duplicates'] must contain the duplicated name"


# ---------------------------------------------------------------------------
# Test 12: duplicate per-sheet only — same name in IND + UAE is valid
# ---------------------------------------------------------------------------


def test_same_client_name_in_both_sheets_is_valid() -> None:
    """'CommonClient' appearing in both India and UAE sheets is valid (no error).

    Duplicate detection is strictly within a single sheet.
    """
    shared_name = "CommonClient Ltd"
    file_bytes = _build_wb_bytes(
        india_rows=[
            _make_ind_row(shared_name, 30),
            _make_ind_row("OtherIndClient Ltd", 0),
        ],
        uae_rows=[
            _make_uae_row(shared_name, 15, "Same group"),
            _make_uae_row("OtherUaeClient LLC", 30),
        ],
    )
    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is True, (
        f"Same client in both sheets must not be a duplicate. "
        f"errors={[e.code for e in result.errors]}"
    )
    dup_errs = [e for e in result.errors if e.code == "DUPLICATE_CLIENT"]
    assert not dup_errs, (
        f"Unexpected DUPLICATE_CLIENT error for cross-sheet name: "
        f"{[e.detail for e in dup_errs]}"
    )


# ---------------------------------------------------------------------------
# Test 13: missing India sheet → SHEET_NOT_FOUND in errors; UAE still processed
# ---------------------------------------------------------------------------


def test_missing_india_sheet_emits_sheet_not_found_and_uae_processed() -> None:
    """Workbook without India sheet → SHEET_NOT_FOUND for India; UAE parsed."""
    file_bytes = _build_wb_bytes(
        india_rows=[],
        uae_rows=[_make_uae_row("UaeOnlyClient LLC", 30)],
        include_india=False,
        include_uae=True,
    )
    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is False, "Missing India sheet must produce an error"

    sheet_errs = [e for e in result.errors if e.code == "SHEET_NOT_FOUND"]
    assert sheet_errs, f"Expected SHEET_NOT_FOUND error. errors={[e.code for e in result.errors]}"
    india_errs = [
        e
        for e in sheet_errs
        if e.detail is not None and e.detail.get("sheet") == "India" or "India" in e.message
    ]
    assert india_errs, "SHEET_NOT_FOUND error must reference the 'India' sheet"

    # UAE sheet must still have been processed.
    uae_rows = [cp for cp in result.credit_periods if cp.entity_code == "UAE"]
    assert len(uae_rows) == 1, (
        f"UAE sheet must still be processed even when India is missing; "
        f"got {len(uae_rows)} UAE rows"
    )


# ---------------------------------------------------------------------------
# Test 14: missing Credit Period column in India → MISSING_REQUIRED_COLUMN
# ---------------------------------------------------------------------------


def test_missing_credit_period_column_emits_error() -> None:
    """India sheet without 'Credit Period' column header → MISSING_REQUIRED_COLUMN."""
    wb = openpyxl.Workbook()
    del wb["Sheet"]

    # India sheet with only Client Name (Credit Period column absent)
    ws_india = wb.create_sheet("India")
    ws_india.append(["Client Name"])  # no Credit Period col
    ws_india.append(["SomeClient Ltd"])

    ws_uae = wb.create_sheet("UAE")
    ws_uae.append(_UAE_HEADER)
    ws_uae.append(_make_uae_row("ValidUaeClient LLC", 30))

    buf = io.BytesIO()
    wb.save(buf)
    file_bytes = buf.getvalue()

    result = parse_credit_period_master(file_bytes)
    assert result.is_valid is False, "Missing Credit Period column must make is_valid False"
    missing_errs = [e for e in result.errors if e.code == "MISSING_REQUIRED_COLUMN"]
    assert missing_errs, (
        f"Expected MISSING_REQUIRED_COLUMN error. " f"errors={[e.code for e in result.errors]}"
    )


# ---------------------------------------------------------------------------
# Test 15: deterministic file_sha256 across two parse calls
# ---------------------------------------------------------------------------


def test_deterministic_file_sha256(simple_cp_bytes: bytes) -> None:
    r1 = parse_credit_period_master(simple_cp_bytes)
    r2 = parse_credit_period_master(simple_cp_bytes)
    assert (
        r1.file_sha256 == r2.file_sha256
    ), "Two parse calls on the same bytes must produce the same file_sha256"
