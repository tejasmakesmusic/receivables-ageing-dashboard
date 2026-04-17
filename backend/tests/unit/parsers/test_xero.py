"""Unit tests for app.parsers.xero (M2 Task 3).

Real-fixture tests skip gracefully when
``MANTARAV_Aged_Receivables_Detail.xlsx`` is absent from the fixture directory.

Data-handling rule (CLAUDE.md §"Data handling"): no assertion or failure
message may contain a raw party name or invoice reference.  All assertions
are structural (counts, totals, status distributions).
"""

from __future__ import annotations

import io
import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import openpyxl
import pytest

from app.parsers.common import ParseStatus, StagedInvoice
from app.parsers.xero import parse_xero_aged_receivables

# ---------------------------------------------------------------------------
# Fixture path
# ---------------------------------------------------------------------------

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "fixtures"
    / "sample_files"
    / "MANTARAV_Aged_Receivables_Detail.xlsx"
)


@pytest.fixture
def xero_file_bytes() -> bytes:
    if not FIXTURE_PATH.exists():
        pytest.skip(f"fixture not present: {FIXTURE_PATH}")
    return FIXTURE_PATH.read_bytes()


# ---------------------------------------------------------------------------
# Synthetic XLSX builder
# ---------------------------------------------------------------------------

# Minimal shape mirrors the real Xero export:
#   Row 0: report title
#   Row 1: company name
#   Row 2: "As at DD Month YYYY"
#   Row 3: ageing method note
#   Row 4: blank
#   Row 5: column headers (23 cols; col 16 is unnamed/blank)
#   Row 6: blank (cosmetic gap before first party group)
#   Row 7+: data rows

_HEADER_ROW: list[Any] = [
    "Contact Account Number",  # 0
    "Primary Person",  # 1
    "Phone",  # 2
    "Email",  # 3
    "Mobile",  # 4
    "Contact Group",  # 5
    "Invoice Date",  # 6
    "Due Date",  # 7
    "Expected Date",  # 8
    "Invoice Number",  # 9
    "Invoice Reference",  # 10
    "< 1 Month",  # 11
    "1 Month",  # 12
    "2 Months",  # 13
    "3 Months",  # 14
    "Older",  # 15
    None,  # 16 (unnamed col, real fixture has blank here)
    "Total",  # 17
    "Outstanding Tax",  # 18
    "PROJECT ID",  # 19
    "SERVICE MONTH",  # 20
    "Invoice Seen",  # 21
    "Invoice Sent",  # 22
]

_META_ROWS: list[list[Any]] = [
    ["Aged Receivables Detail"] + [None] * 22,
    ["TEST COMPANY LLC"] + [None] * 22,
    ["As at 31 March 2026"] + [None] * 22,
    ["Ageing by due date"] + [None] * 22,
    [None] * 23,
    _HEADER_ROW,
    [None] * 23,  # blank gap row (row 6)
]


def _make_invoice_row(
    party: str | None = None,
    inv_date: Any = date(2026, 1, 15),
    inv_num: str | None = "INV-TEST-001",
    total: float | None = 1000.0,
    inv_seen: str = "Not seen",
    inv_sent: str = "Sent",
    inv_ref: str = "Contact Person",
    service_month: str | None = None,
    project_id: str | None = None,
    primary_person: str | None = None,
    email: str | None = None,
) -> list[Any]:
    """Build a synthetic invoice row (23 cols, col layout per _HEADER_ROW)."""
    row: list[Any] = [None] * 23
    row[0] = party  # Contact Account Number (blank for normal invoice rows)
    row[1] = primary_person
    row[3] = email
    row[6] = inv_date
    row[7] = inv_date  # Due Date (same for simplicity)
    row[8] = inv_date  # Expected Date
    row[9] = inv_num
    row[10] = inv_ref  # Invoice Reference (contact name — goes to raw_row_json only)
    row[11] = 0
    row[12] = 0
    row[13] = 0
    row[14] = 0
    row[15] = total  # Older bucket
    row[17] = total  # Total
    row[18] = 0
    row[19] = project_id
    row[20] = service_month
    row[21] = inv_seen
    row[22] = inv_sent
    return row


def _make_party_header(party_name: str) -> list[Any]:
    """Party header row: only Contact Account Number populated."""
    row: list[Any] = [None] * 23
    row[0] = party_name
    return row


def _make_subtotal(party_name: str, total: float = 1000.0) -> list[Any]:
    """Party sub-total row: col0 = 'Total <party_name>'."""
    row: list[Any] = [None] * 23
    row[0] = f"Total {party_name}"
    row[11] = 0
    row[12] = 0
    row[13] = 0
    row[14] = 0
    row[15] = 0
    row[17] = 0
    row[18] = 0
    return row


def _make_grand_total(total: float = 0.0) -> list[Any]:
    """Grand total row: col0 = 'Total' (no trailing content)."""
    row: list[Any] = [None] * 23
    row[0] = "Total"
    row[11] = 0
    row[12] = 0
    row[13] = 0
    row[14] = 0
    row[15] = 0
    row[17] = total
    row[18] = 0
    return row


def _build_wb_bytes(
    data_rows: list[list[Any]],
    as_of_str: str = "As at 31 March 2026",
) -> bytes:
    """Create a minimal Xero-shaped XLSX in memory.

    Args:
        data_rows: Rows appended after the 7 metadata rows (_META_ROWS).
        as_of_str: Overrides the "As at ..." string in row 2 (for sniff tests).

    Returns:
        Raw bytes of the ``.xlsx`` file.
    """
    wb = openpyxl.Workbook()
    ws = wb.create_sheet("Aged Receivables Detail")
    del wb["Sheet"]

    meta = [row[:] for row in _META_ROWS]
    meta[2][0] = as_of_str  # override row 2 col 0

    for row in meta:
        ws.append(row)

    for row in data_rows:
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Minimal valid synthetic fixture
# ---------------------------------------------------------------------------

_PARTY_A = "AlphaVendor Ltd"
_PARTY_B = "BetaCorp LLC"

_SIMPLE_DATA_ROWS: list[list[Any]] = [
    _make_party_header(_PARTY_A),
    _make_invoice_row(inv_num="INV-A-001", total=500.0, inv_seen="Seen"),
    _make_invoice_row(inv_num="INV-A-002", total=500.0, inv_seen="Seen"),
    _make_subtotal(_PARTY_A, 1000.0),
    _make_party_header(_PARTY_B),
    _make_invoice_row(inv_num="INV-B-001", total=200.0, inv_seen="Not seen"),
    _make_subtotal(_PARTY_B, 200.0),
    _make_grand_total(0.0),
]


@pytest.fixture
def simple_xero_bytes() -> bytes:
    return _build_wb_bytes(_SIMPLE_DATA_ROWS)


# ---------------------------------------------------------------------------
# Test 1: source_hint and sha256 shape
# ---------------------------------------------------------------------------


def test_source_hint_xero_and_sha256_64_char_hex(simple_xero_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(simple_xero_bytes)
    assert result.source_hint == "XERO"
    assert len(result.file_sha256) == 64
    assert all(c in "0123456789abcdef" for c in result.file_sha256)


# ---------------------------------------------------------------------------
# Test 2: every OK invoice has source_currency == "AED"
# ---------------------------------------------------------------------------


def test_all_ok_invoices_are_aed(simple_xero_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(simple_xero_bytes)
    ok_invoices = [i for i in result.invoices if i.status == ParseStatus.OK]
    assert ok_invoices, "Expected at least one OK invoice"
    assert all(i.source_currency == "AED" for i in ok_invoices)


# ---------------------------------------------------------------------------
# Test 3: as_of_date sniffed from real fixture
# ---------------------------------------------------------------------------


def test_as_of_date_sniffed_real_fixture(xero_file_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(xero_file_bytes)
    assert isinstance(
        result.as_of_date, date
    ), f"Expected as_of_date to be a date, got {result.as_of_date!r}"
    # Plausible range: 2020-01-01 to 2030-12-31
    assert (
        date(2020, 1, 1) <= result.as_of_date <= date(2030, 12, 31)
    ), f"as_of_date {result.as_of_date} is outside plausible range"
    # No AS_OF_DATE_SNIFF_FAILED warning on real fixture.
    sniff_warnings = [w for w in result.warnings if w.code == "AS_OF_DATE_SNIFF_FAILED"]
    assert (
        not sniff_warnings
    ), f"Unexpected AS_OF_DATE_SNIFF_FAILED on real fixture; date sniffed={result.as_of_date}"


# ---------------------------------------------------------------------------
# Test 4: xero_metadata present on every OK invoice with exactly 6 keys
# ---------------------------------------------------------------------------


def test_xero_metadata_on_ok_invoices_has_exactly_six_keys(simple_xero_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(simple_xero_bytes)
    ok_invoices = [i for i in result.invoices if i.status == ParseStatus.OK]
    assert ok_invoices, "Expected at least one OK invoice"
    required_keys = {
        "invoice_seen",
        "invoice_sent",
        "project_id",
        "service_month",
        "primary_person",
        "email",
    }
    for inv in ok_invoices:
        assert (
            inv.xero_metadata is not None
        ), f"OK invoice at row {inv.row_index} has xero_metadata=None"
        assert set(inv.xero_metadata.keys()) == required_keys, (
            f"xero_metadata keys mismatch at row {inv.row_index}: "
            f"got {set(inv.xero_metadata.keys())}"
        )
        for key, val in inv.xero_metadata.items():
            assert val is None or isinstance(val, str), (
                f"xero_metadata[{key!r}] at row {inv.row_index} "
                f"must be str|None, got {type(val)}"
            )


# ---------------------------------------------------------------------------
# Test 5: xero_metadata round-trips through JSON per OK invoice
# ---------------------------------------------------------------------------


def test_xero_metadata_json_round_trip(simple_xero_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(simple_xero_bytes)
    ok_invoices = [i for i in result.invoices if i.status == ParseStatus.OK]
    assert ok_invoices, "Expected at least one OK invoice"
    for inv in ok_invoices:
        assert inv.xero_metadata is not None
        try:
            serialized = json.dumps(inv.xero_metadata)
            deserialized = json.loads(serialized)
            assert (
                deserialized == inv.xero_metadata
            ), f"xero_metadata round-trip mismatch at row {inv.row_index}"
        except (TypeError, ValueError) as exc:
            pytest.fail(f"xero_metadata at row {inv.row_index} is not JSON-safe: {exc}")


# ---------------------------------------------------------------------------
# Test 6: no OK invoice has party_name_raw starting with "Total"
# ---------------------------------------------------------------------------


def test_no_ok_invoice_party_name_starts_with_total(simple_xero_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(simple_xero_bytes)
    ok_invoices = [i for i in result.invoices if i.status == ParseStatus.OK]
    for inv in ok_invoices:
        assert not inv.party_name_raw.startswith("Total"), (
            f"OK invoice at row {inv.row_index} has party_name_raw "
            f"starting with 'Total' (sub-total / grand-total leaked)"
        )


# ---------------------------------------------------------------------------
# Test 7: raw_row_json is JSON-safe for every invoice
# ---------------------------------------------------------------------------


def test_raw_row_json_is_json_safe_for_all_invoices(simple_xero_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(simple_xero_bytes)
    for inv in result.invoices:
        try:
            json.dumps(inv.raw_row_json)
        except (TypeError, ValueError) as exc:
            pytest.fail(f"raw_row_json at row {inv.row_index} is not JSON-safe: {exc}")


# ---------------------------------------------------------------------------
# Test 8: Due Date not in model fields, but IS in raw_row_json
# ---------------------------------------------------------------------------


def test_due_date_not_in_model_fields_but_in_raw_row_json(xero_file_bytes: bytes) -> None:
    # Structural: "Due Date" must not be a direct model field.
    assert "Due Date" not in StagedInvoice.model_fields
    assert "due_date" not in StagedInvoice.model_fields

    # Behavioural: every OK invoice's raw_row_json includes "Due Date".
    result = parse_xero_aged_receivables(xero_file_bytes)
    ok_invoices = [i for i in result.invoices if i.status == ParseStatus.OK]
    assert ok_invoices, "Expected at least one OK invoice on real fixture"
    for inv in ok_invoices:
        assert (
            "Due Date" in inv.raw_row_json
        ), f"OK invoice at row {inv.row_index} missing 'Due Date' in raw_row_json"
        val = inv.raw_row_json["Due Date"]
        assert val is None or isinstance(
            val, str
        ), f"raw_row_json['Due Date'] at row {inv.row_index} must be str|None, got {type(val)}"


# ---------------------------------------------------------------------------
# Test 9: real fixture exact OK invoice count
# Per real fixture inspection 2026-04-17: 53 OK invoices, 4 PARSE_ERROR credit notes.
# ---------------------------------------------------------------------------


def test_real_fixture_ok_invoice_count(xero_file_bytes: bytes) -> None:
    """Real MANTARAV_Aged_Receivables_Detail.xlsx must produce exactly 53 OK invoices.

    Verified by direct parse run on the fixture (2026-04-17) with exactly 4
    PARSE_ERROR rows (credit notes/adjustments without Invoice Number).
    If the fixture is replaced, re-measure and update this count.
    """
    result = parse_xero_aged_receivables(xero_file_bytes)
    ok_invoices = [i for i in result.invoices if i.status == ParseStatus.OK]
    # Per real fixture inspection 2026-04-17: 53 OK invoices
    assert len(ok_invoices) == 53, (
        f"Expected 53 OK invoices on real fixture; got {len(ok_invoices)}. "
        "If the fixture was replaced, re-measure and update this count."
    )


# ---------------------------------------------------------------------------
# Test 10: real fixture is_valid == True
# ---------------------------------------------------------------------------


def test_real_fixture_is_valid(xero_file_bytes: bytes) -> None:
    result = parse_xero_aged_receivables(xero_file_bytes)
    assert result.is_valid is True, (
        f"Expected is_valid=True on real fixture. " f"errors={[e.code for e in result.errors]}"
    )


# ---------------------------------------------------------------------------
# Test 11: synthetic GRAND_TOTAL_MISMATCH in warnings (non-blocking)
# ---------------------------------------------------------------------------


def test_grand_total_mismatch_warning_synthetic() -> None:
    """Sum-of-invoice-totals offset by AED 10 from grand total → GRAND_TOTAL_MISMATCH warning.

    Per ADR-0004: GRAND_TOTAL_MISMATCH is a WARNING (not an error).
    is_valid stays True; detail.delta == AED 10.
    """
    # 2 invoices, total = 990. Grand total = 1000. Delta = 10.
    data_rows: list[list[Any]] = [
        _make_party_header("SyntheticParty"),
        _make_invoice_row(inv_num="SYN-001", total=500.0, inv_seen="Seen"),
        _make_invoice_row(inv_num="SYN-002", total=490.0, inv_seen="Seen"),
        _make_subtotal("SyntheticParty", 990.0),
        _make_grand_total(1000.0),  # grand total 10 above sum-of-invoices
    ]
    file_bytes = _build_wb_bytes(data_rows)
    result = parse_xero_aged_receivables(file_bytes)

    mismatch_warnings = [w for w in result.warnings if w.code == "GRAND_TOTAL_MISMATCH"]
    assert mismatch_warnings, (
        f"Expected GRAND_TOTAL_MISMATCH in warnings. "
        f"warnings={[w.code for w in result.warnings]}"
    )
    # Non-blocking contract.
    assert result.is_valid is True
    assert not any(e.code == "GRAND_TOTAL_MISMATCH" for e in result.errors)
    # Exact delta.
    w = mismatch_warnings[0]
    assert w.detail is not None
    assert Decimal(w.detail["delta"]) == Decimal(
        "10"
    ), f"Expected delta=10, got {w.detail['delta']!r}"


# ---------------------------------------------------------------------------
# Test 12: synthetic INVOICE_SEEN_HIGH warning (3/5 = 60%)
# ---------------------------------------------------------------------------


def test_invoice_seen_high_warning_synthetic() -> None:
    """3 of 5 invoices with Invoice Seen='Not seen' (60%) → INVOICE_SEEN_HIGH warning.

    Threshold is 20% per spec §4.2 rule 8.
    """
    data_rows: list[list[Any]] = [
        _make_party_header("SeenTestParty"),
        _make_invoice_row(inv_num="SEE-001", total=100.0, inv_seen="Not seen"),
        _make_invoice_row(inv_num="SEE-002", total=100.0, inv_seen="Not seen"),
        _make_invoice_row(inv_num="SEE-003", total=100.0, inv_seen="Not seen"),
        _make_invoice_row(inv_num="SEE-004", total=100.0, inv_seen="Seen"),
        _make_invoice_row(inv_num="SEE-005", total=100.0, inv_seen="Seen"),
        _make_subtotal("SeenTestParty", 500.0),
        _make_grand_total(0.0),
    ]
    file_bytes = _build_wb_bytes(data_rows)
    result = parse_xero_aged_receivables(file_bytes)

    seen_warnings = [w for w in result.warnings if w.code == "INVOICE_SEEN_HIGH"]
    assert seen_warnings, (
        f"Expected INVOICE_SEEN_HIGH in warnings. " f"warnings={[w.code for w in result.warnings]}"
    )
    w = seen_warnings[0]
    assert w.detail is not None
    assert (
        w.detail["not_seen_count"] == 3
    ), f"Expected not_seen_count=3, got {w.detail['not_seen_count']}"
    assert (
        w.detail["percentage"] > 0.20
    ), f"Expected percentage > 0.20, got {w.detail['percentage']}"


# ---------------------------------------------------------------------------
# Test 13: synthetic malformed Invoice Date → PARSE_ERROR
# ---------------------------------------------------------------------------


def test_malformed_invoice_date_emits_parse_error() -> None:
    """A row with Invoice Date='not-a-date' emits status=PARSE_ERROR with non-empty reason."""
    data_rows: list[list[Any]] = [
        _make_party_header("BrokenDateParty"),
        _make_invoice_row(inv_num="BAD-001", inv_date="not-a-date", total=100.0),
        _make_subtotal("BrokenDateParty", 100.0),
        _make_grand_total(0.0),
    ]
    file_bytes = _build_wb_bytes(data_rows)
    result = parse_xero_aged_receivables(file_bytes)

    error_rows = [i for i in result.invoices if i.status == ParseStatus.PARSE_ERROR]
    assert error_rows, "Expected at least one PARSE_ERROR row for malformed date"
    for err in error_rows:
        assert (
            err.parse_error_reason
        ), f"PARSE_ERROR at row {err.row_index} has empty parse_error_reason"


# ---------------------------------------------------------------------------
# Test 14: synthetic NaN Invoice Number → PARSE_ERROR (credit note path)
# ---------------------------------------------------------------------------


def test_nan_invoice_number_emits_parse_error_credit_note() -> None:
    """A row with Invoice Date populated but Invoice Number NaN → PARSE_ERROR.

    The parse_error_reason must contain 'no invoice number' or 'credit note'.
    invoice_ref, amount, invoice_date must all be None on the PARSE_ERROR row.
    """
    data_rows: list[list[Any]] = [
        _make_party_header("CreditNoteParty"),
        _make_invoice_row(inv_num=None, total=-500.0, inv_seen="Not seen"),  # credit note
        _make_subtotal("CreditNoteParty", -500.0),
        _make_grand_total(0.0),
    ]
    file_bytes = _build_wb_bytes(data_rows)
    result = parse_xero_aged_receivables(file_bytes)

    credit_errors = [i for i in result.invoices if i.status == ParseStatus.PARSE_ERROR]
    assert credit_errors, "Expected at least one PARSE_ERROR for credit note (NaN Invoice Number)"

    err = credit_errors[0]
    assert err.parse_error_reason, "PARSE_ERROR must have non-empty parse_error_reason"
    reason_lower = err.parse_error_reason.lower()
    assert "no invoice number" in reason_lower or "credit note" in reason_lower, (
        f"parse_error_reason should mention 'no invoice number' or 'credit note'; "
        f"got: {err.parse_error_reason!r}"
    )
    # Per spec §4.4 contract: invoice_ref, amount, invoice_date all None on PARSE_ERROR.
    assert err.invoice_ref is None, "PARSE_ERROR invoice_ref must be None"
    assert err.amount is None, "PARSE_ERROR amount must be None"
    assert err.invoice_date is None, "PARSE_ERROR invoice_date must be None"


# ---------------------------------------------------------------------------
# Test 15: sniff failure → as_of_date is None, AS_OF_DATE_SNIFF_FAILED warning, is_valid True
# ---------------------------------------------------------------------------


def test_as_of_date_sniff_failure_produces_warning_not_error() -> None:
    """Row 2 = 'not a date' → as_of_date is None, AS_OF_DATE_SNIFF_FAILED in warnings."""
    data_rows: list[list[Any]] = [
        _make_party_header("SniffTestParty"),
        _make_invoice_row(inv_num="SNF-001", total=100.0),
        _make_subtotal("SniffTestParty", 100.0),
        _make_grand_total(0.0),
    ]
    file_bytes = _build_wb_bytes(data_rows, as_of_str="not a date")
    result = parse_xero_aged_receivables(file_bytes)

    assert (
        result.as_of_date is None
    ), f"Expected as_of_date=None on sniff failure, got {result.as_of_date!r}"
    sniff_warnings = [w for w in result.warnings if w.code == "AS_OF_DATE_SNIFF_FAILED"]
    assert sniff_warnings, (
        f"Expected AS_OF_DATE_SNIFF_FAILED in warnings. "
        f"warnings={[w.code for w in result.warnings]}"
    )
    assert result.is_valid is True, (
        f"AS_OF_DATE_SNIFF_FAILED must be non-blocking; is_valid should be True. "
        f"errors={[e.code for e in result.errors]}"
    )


# ---------------------------------------------------------------------------
# Test 16: deterministic file_sha256
# ---------------------------------------------------------------------------


def test_deterministic_file_sha256(simple_xero_bytes: bytes) -> None:
    r1 = parse_xero_aged_receivables(simple_xero_bytes)
    r2 = parse_xero_aged_receivables(simple_xero_bytes)
    assert r1.file_sha256 == r2.file_sha256
