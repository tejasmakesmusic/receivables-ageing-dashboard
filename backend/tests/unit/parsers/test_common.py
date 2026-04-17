"""Unit tests for app.parsers.common (M2 Task 1).

All tests use synthetic data only — real client fixture files in
backend/tests/fixtures/sample_files/ are NOT opened here (CLAUDE.md §"Data handling").
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.parsers.common import (
    ParseError,
    ParseResult,
    ParseStatus,
    StagedCreditPeriod,
    StagedInvoice,
    compute_file_sha256,
)

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

_VALID_RAW_ROW: dict[str, object] = {
    "date": "2025-01-15",
    "ref_no": "INV-001",
    "party_name": "Acme Corp",
    "opening_amount": "100000.00",
    "pending_amount": "80000.00",
}


def _make_ok_invoice(**kwargs: object) -> StagedInvoice:
    defaults: dict[str, object] = {
        "row_index": 0,
        "source_currency": "INR",
        "party_name_raw": "Acme Corp",
        "invoice_ref": "INV-001",
        "invoice_date": date(2025, 1, 15),
        "amount": Decimal("80000.00"),
        "raw_row_json": _VALID_RAW_ROW,
    }
    defaults.update(kwargs)
    return StagedInvoice(**defaults)


# ---------------------------------------------------------------------------
# 1. StagedInvoice — happy path (OK status)
# ---------------------------------------------------------------------------


def test_staged_invoice_ok_happy_path() -> None:
    """All fields populated, validates, round-trips through model_dump_json."""
    inv = _make_ok_invoice()

    assert inv.status == ParseStatus.OK
    assert inv.invoice_ref == "INV-001"
    assert inv.invoice_date == date(2025, 1, 15)
    assert inv.amount == Decimal("80000.00")
    assert inv.source_currency == "INR"
    assert inv.parse_error_reason is None
    assert inv.xero_metadata is None

    # Round-trip through JSON
    json_str = inv.model_dump_json()
    data = json.loads(json_str)
    assert data["invoice_ref"] == "INV-001"
    assert data["status"] == "OK"


# ---------------------------------------------------------------------------
# 2. StagedInvoice — PARSE_ERROR row (nullable fields allowed)
# ---------------------------------------------------------------------------


def test_staged_invoice_parse_error_row() -> None:
    """PARSE_ERROR status + Nones + reason → validator passes."""
    inv = StagedInvoice(
        row_index=7,
        status=ParseStatus.PARSE_ERROR,
        source_currency="AED",
        party_name_raw="Unknown Party",
        invoice_ref=None,
        invoice_date=None,
        amount=None,
        raw_row_json={"raw": "garbage data", "col_b": "???"},
        parse_error_reason="Could not parse date field: '32-Jan-2025'",
    )

    assert inv.status == ParseStatus.PARSE_ERROR
    assert inv.invoice_ref is None
    assert inv.invoice_date is None
    assert inv.amount is None
    assert inv.parse_error_reason == "Could not parse date field: '32-Jan-2025'"
    assert inv.row_index == 7


# ---------------------------------------------------------------------------
# 3. StagedInvoice — validator rejections
# ---------------------------------------------------------------------------


def test_staged_invoice_parse_error_without_reason_raises() -> None:
    """status=PARSE_ERROR without parse_error_reason must raise ValidationError."""
    with pytest.raises(ValidationError, match="parse_error_reason"):
        StagedInvoice(
            row_index=3,
            status=ParseStatus.PARSE_ERROR,
            source_currency="INR",
            party_name_raw="Some Party",
            raw_row_json={},
            # parse_error_reason deliberately omitted
        )


def test_staged_invoice_ok_with_none_invoice_ref_raises() -> None:
    """status=OK with invoice_ref=None must raise ValidationError."""
    with pytest.raises(ValidationError, match="invoice_ref"):
        StagedInvoice(
            row_index=1,
            status=ParseStatus.OK,
            source_currency="INR",
            party_name_raw="Acme Corp",
            invoice_ref=None,  # must not be None for OK
            invoice_date=date(2025, 1, 15),
            amount=Decimal("5000.00"),
            raw_row_json=_VALID_RAW_ROW,
        )


def test_staged_invoice_ok_with_none_invoice_date_raises() -> None:
    """status=OK with invoice_date=None must raise ValidationError."""
    with pytest.raises(ValidationError, match="invoice_date"):
        StagedInvoice(
            row_index=2,
            status=ParseStatus.OK,
            source_currency="INR",
            party_name_raw="Acme Corp",
            invoice_ref="INV-002",
            invoice_date=None,
            amount=Decimal("5000.00"),
            raw_row_json=_VALID_RAW_ROW,
        )


def test_staged_invoice_ok_with_none_amount_raises() -> None:
    """status=OK with amount=None must raise ValidationError."""
    with pytest.raises(ValidationError, match="amount"):
        StagedInvoice(
            row_index=3,
            status=ParseStatus.OK,
            source_currency="INR",
            party_name_raw="Acme Corp",
            invoice_ref="INV-003",
            invoice_date=date(2025, 1, 15),
            amount=None,
            raw_row_json=_VALID_RAW_ROW,
        )


# ---------------------------------------------------------------------------
# 4. StagedCreditPeriod — credit_days=0 is valid
# ---------------------------------------------------------------------------


def test_staged_credit_period_zero_days_valid() -> None:
    """credit_days=0 must validate (immediate payment is a legal term)."""
    cp = StagedCreditPeriod(
        row_index=0,
        entity_code="IND",
        name="FastPay Ltd",
        credit_days=0,
    )
    assert cp.credit_days == 0
    assert cp.entity_code == "IND"
    assert cp.reason_note is None


# ---------------------------------------------------------------------------
# 5. StagedCreditPeriod — negative credit_days raises
# ---------------------------------------------------------------------------


def test_staged_credit_period_negative_days_raises() -> None:
    """credit_days < 0 must raise ValidationError."""
    with pytest.raises(ValidationError, match="credit_days"):
        StagedCreditPeriod(
            row_index=1,
            entity_code="UAE",
            name="Some Client",
            credit_days=-5,
        )


# ---------------------------------------------------------------------------
# 6. StagedCreditPeriod — empty name raises
# ---------------------------------------------------------------------------


def test_staged_credit_period_empty_name_raises() -> None:
    """An empty (or whitespace-only) name must raise ValidationError."""
    with pytest.raises(ValidationError, match="name"):
        StagedCreditPeriod(
            row_index=2,
            entity_code="IND",
            name="   ",  # whitespace only
            credit_days=30,
        )


def test_staged_credit_period_blank_name_raises() -> None:
    """An empty string name must raise ValidationError."""
    with pytest.raises(ValidationError, match="name"):
        StagedCreditPeriod(
            row_index=3,
            entity_code="UAE",
            name="",
            credit_days=45,
        )


# ---------------------------------------------------------------------------
# 7. ParseResult.is_valid — True when errors=[], even with warnings
# ---------------------------------------------------------------------------


def test_parse_result_is_valid_no_errors() -> None:
    """is_valid is True when errors list is empty."""
    result = ParseResult(
        file_sha256="abc123",
        source_hint="TALLY",
        errors=[],
        warnings=[],
    )
    assert result.is_valid is True


def test_parse_result_is_valid_with_warnings_no_errors() -> None:
    """is_valid is True even when warnings are present (warnings don't block)."""
    warning = ParseError(
        row_index=5,
        code="SUBTOTAL_MISMATCH",
        message="Sub-total for Party X differs from sum of invoices by ₹0.50",
    )
    result = ParseResult(
        file_sha256="abc123",
        source_hint="TALLY",
        errors=[],
        warnings=[warning],
    )
    assert result.is_valid is True
    assert len(result.warnings) == 1


# ---------------------------------------------------------------------------
# 8. ParseResult.is_valid — False when errors non-empty
# ---------------------------------------------------------------------------


def test_parse_result_is_valid_false_when_errors() -> None:
    """is_valid is False when errors list is non-empty."""
    error = ParseError(
        row_index=-1,
        code="GRAND_TOTAL_MISMATCH",
        message="Extracted total 99999.00 != grand total 100000.00 (diff ₹1.00)",
        detail={"extracted": "99999.00", "tally_grand": "100000.00"},
    )
    result = ParseResult(
        file_sha256="deadbeef",
        source_hint="TALLY",
        errors=[error],
    )
    assert result.is_valid is False
    assert len(result.errors) == 1


# ---------------------------------------------------------------------------
# 9. compute_file_sha256
# ---------------------------------------------------------------------------


def test_compute_file_sha256_hello() -> None:
    """SHA-256 of b'hello' must equal hashlib reference."""
    expected = hashlib.sha256(b"hello").hexdigest()
    assert compute_file_sha256(b"hello") == expected


def test_compute_file_sha256_empty() -> None:
    """SHA-256 of empty bytes produces the well-known digest."""
    expected = hashlib.sha256(b"").hexdigest()
    assert compute_file_sha256(b"") == expected


def test_compute_file_sha256_deterministic() -> None:
    """Same input → same output (deterministic)."""
    data = b"some file content \x00\x01\x02"
    assert compute_file_sha256(data) == compute_file_sha256(data)


# ---------------------------------------------------------------------------
# 10. Decimal precision survives model_dump_json
# ---------------------------------------------------------------------------


def test_decimal_amount_survives_json_round_trip() -> None:
    """Decimal in StagedInvoice.amount must keep precision through JSON.

    Pydantic v2 serialises Decimal as a string by default.  This test
    asserts the serialised value is parseable back to the same Decimal
    without floating-point loss.
    """
    precise_amount = Decimal("123456789.99")
    inv = _make_ok_invoice(amount=precise_amount)

    json_str = inv.model_dump_json()
    data = json.loads(json_str)

    # Pydantic v2 serialises Decimal as a string — parse back and compare.
    recovered = Decimal(str(data["amount"]))
    assert (
        recovered == precise_amount
    ), f"Precision lost: expected {precise_amount!r}, got {recovered!r}"


def test_decimal_zero_amount_survives_json_round_trip() -> None:
    """Decimal('0.00') also round-trips correctly."""
    inv = _make_ok_invoice(amount=Decimal("0.00"))
    data = json.loads(inv.model_dump_json())
    assert Decimal(str(data["amount"])) == Decimal("0.00")


# ---------------------------------------------------------------------------
# Bonus: __init__.py re-exports work
# ---------------------------------------------------------------------------


def test_parsers_package_exports() -> None:
    """Public names must be importable directly from app.parsers."""
    import app.parsers as pkg

    for name in [
        "ParseError",
        "ParseResult",
        "ParseStatus",
        "StagedCreditPeriod",
        "StagedInvoice",
        "compute_file_sha256",
    ]:
        assert hasattr(pkg, name), f"app.parsers missing export: {name}"
