"""Unit tests for app.services.source_detect (M3 Task 2)."""

from __future__ import annotations

import io

import openpyxl
import pytest

from app.services.source_detect import (
    AmbiguousSourceError,
    detect_source_from_xlsx,
    validate_source_hint_against_file,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_xlsx(sheet_names: list[str]) -> bytes:
    """Build a minimal XLSX with the given sheet names."""
    wb = openpyxl.Workbook()
    # rename the default sheet to the first name
    wb.active.title = sheet_names[0]  # type: ignore[union-attr]
    for name in sheet_names[1:]:
        wb.create_sheet(name)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Detection: happy paths
# ---------------------------------------------------------------------------


class TestDetectSourceFromXlsx:
    def test_tally_detected(self) -> None:
        xlsx = _make_xlsx(["Sundry Debtors"])
        assert detect_source_from_xlsx(xlsx) == "TALLY"

    def test_xero_detected(self) -> None:
        xlsx = _make_xlsx(["Aged Receivables Detail"])
        assert detect_source_from_xlsx(xlsx) == "XERO"

    def test_credit_period_detected(self) -> None:
        xlsx = _make_xlsx(["India", "UAE"])
        assert detect_source_from_xlsx(xlsx) == "CREDIT_PERIOD"

    def test_credit_period_with_extra_sheets(self) -> None:
        """Extra sheets alongside India+UAE still → CREDIT_PERIOD."""
        xlsx = _make_xlsx(["India", "UAE", "Summary"])
        assert detect_source_from_xlsx(xlsx) == "CREDIT_PERIOD"

    def test_no_match_returns_none(self) -> None:
        xlsx = _make_xlsx(["Sheet1", "Sheet2"])
        assert detect_source_from_xlsx(xlsx) is None

    def test_unknown_single_sheet(self) -> None:
        xlsx = _make_xlsx(["RandomSheet"])
        assert detect_source_from_xlsx(xlsx) is None

    def test_only_india_no_match(self) -> None:
        """India without UAE does not match CREDIT_PERIOD."""
        xlsx = _make_xlsx(["India"])
        assert detect_source_from_xlsx(xlsx) is None

    def test_only_uae_no_match(self) -> None:
        """UAE without India does not match CREDIT_PERIOD."""
        xlsx = _make_xlsx(["UAE"])
        assert detect_source_from_xlsx(xlsx) is None


# ---------------------------------------------------------------------------
# Detection: ambiguous (multiple matches)
# ---------------------------------------------------------------------------


class TestAmbiguousSource:
    def test_tally_and_xero_ambiguous(self) -> None:
        xlsx = _make_xlsx(["Sundry Debtors", "Aged Receivables Detail"])
        with pytest.raises(AmbiguousSourceError) as exc_info:
            detect_source_from_xlsx(xlsx)
        assert "TALLY" in exc_info.value.matched
        assert "XERO" in exc_info.value.matched

    def test_tally_and_credit_period_ambiguous(self) -> None:
        xlsx = _make_xlsx(["Sundry Debtors", "India", "UAE"])
        with pytest.raises(AmbiguousSourceError) as exc_info:
            detect_source_from_xlsx(xlsx)
        assert "TALLY" in exc_info.value.matched
        assert "CREDIT_PERIOD" in exc_info.value.matched

    def test_all_three_ambiguous(self) -> None:
        xlsx = _make_xlsx(["Sundry Debtors", "Aged Receivables Detail", "India", "UAE"])
        with pytest.raises(AmbiguousSourceError) as exc_info:
            detect_source_from_xlsx(xlsx)
        assert len(exc_info.value.matched) == 3


# ---------------------------------------------------------------------------
# Validate hint against file
# ---------------------------------------------------------------------------


class TestValidateSourceHintAgainstFile:
    def test_matching_tally(self) -> None:
        xlsx = _make_xlsx(["Sundry Debtors"])
        # Should not raise.
        validate_source_hint_against_file(xlsx, "TALLY")

    def test_matching_xero(self) -> None:
        xlsx = _make_xlsx(["Aged Receivables Detail"])
        validate_source_hint_against_file(xlsx, "XERO")

    def test_matching_credit_period(self) -> None:
        xlsx = _make_xlsx(["India", "UAE"])
        validate_source_hint_against_file(xlsx, "CREDIT_PERIOD")

    def test_mismatch_raises_value_error(self) -> None:
        xlsx = _make_xlsx(["Sundry Debtors"])
        with pytest.raises(ValueError, match="mismatch"):
            validate_source_hint_against_file(xlsx, "XERO")

    def test_no_detection_trusts_caller(self) -> None:
        """When detection returns None, caller's hint is accepted."""
        xlsx = _make_xlsx(["UnknownSheet"])
        # Should not raise — detection returns None, we trust caller.
        validate_source_hint_against_file(xlsx, "TALLY")
