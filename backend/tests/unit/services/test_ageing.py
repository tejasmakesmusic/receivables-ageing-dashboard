"""Unit tests for app.services.ageing (M2 Task 5).

Coverage targets from spec §12 + task description:
  - Boundary tests at overdue_days: -1, 0, 30, 31, 60, 61, 90, 91, 365
  - credit_days edge cases: 0 (immediate), 30, 365
  - Backdated / weird as_of_date (as_of_date < invoice_date)
  - Negative credit_days → ValueError
  - Non-date inputs → TypeError
  - Determinism proof via freezegun (function must NOT call datetime.today())
  - AgeingResult is frozen (immutable)
  - JSON round-trip: due_date as ISO string
  - AgeingBucket enum values match spec §2 D6 exactly
"""

from __future__ import annotations

import datetime
import json

import pytest
from freezegun import freeze_time
from pydantic import ValidationError

from app.services import AgeingBucket as ExportedBucket  # re-export test
from app.services import AgeingResult as ExportedResult
from app.services import compute_ageing as exported_compute_ageing
from app.services.ageing import AgeingBucket, AgeingResult, compute_ageing

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_INVOICE_DATE = datetime.date(2025, 1, 1)


def _ageing(
    *,
    invoice_date: datetime.date = _BASE_INVOICE_DATE,
    credit_days: int = 30,
    as_of_date: datetime.date,
) -> AgeingResult:
    return compute_ageing(
        invoice_date=invoice_date,
        credit_days=credit_days,
        as_of_date=as_of_date,
    )


# ---------------------------------------------------------------------------
# 1–9: Boundary tests (spec §12)
# ---------------------------------------------------------------------------
# due_date = 2025-01-01 + 30 days = 2025-01-31  (with credit_days=30)


def test_boundary_overdue_minus1_is_not_due() -> None:
    """overdue_days == -1: as_of_date is one day before due_date → NOT_DUE."""
    # due_date = 2025-01-31; as_of_date = 2025-01-30
    result = _ageing(as_of_date=datetime.date(2025, 1, 30))
    assert result.overdue_days == -1
    assert result.bucket == AgeingBucket.NOT_DUE


def test_boundary_overdue_0_is_0_30() -> None:
    """overdue_days == 0: exactly on due_date → 0_30."""
    # due_date = as_of_date = 2025-01-31
    result = _ageing(as_of_date=datetime.date(2025, 1, 31))
    assert result.overdue_days == 0
    assert result.bucket == AgeingBucket.BUCKET_0_30


def test_boundary_overdue_30_is_0_30() -> None:
    """overdue_days == 30: upper boundary of first bucket → 0_30."""
    # as_of_date = 2025-01-31 + 30 = 2025-03-02
    result = _ageing(as_of_date=datetime.date(2025, 3, 2))
    assert result.overdue_days == 30
    assert result.bucket == AgeingBucket.BUCKET_0_30


def test_boundary_overdue_31_is_31_60() -> None:
    """overdue_days == 31 → 31_60."""
    result = _ageing(as_of_date=datetime.date(2025, 3, 3))
    assert result.overdue_days == 31
    assert result.bucket == AgeingBucket.BUCKET_31_60


def test_boundary_overdue_60_is_31_60() -> None:
    """overdue_days == 60: upper boundary of second bucket → 31_60."""
    result = _ageing(as_of_date=datetime.date(2025, 4, 1))
    assert result.overdue_days == 60
    assert result.bucket == AgeingBucket.BUCKET_31_60


def test_boundary_overdue_61_is_61_90() -> None:
    """overdue_days == 61 → 61_90."""
    result = _ageing(as_of_date=datetime.date(2025, 4, 2))
    assert result.overdue_days == 61
    assert result.bucket == AgeingBucket.BUCKET_61_90


def test_boundary_overdue_90_is_61_90() -> None:
    """overdue_days == 90: upper boundary of third bucket → 61_90."""
    result = _ageing(as_of_date=datetime.date(2025, 5, 1))
    assert result.overdue_days == 90
    assert result.bucket == AgeingBucket.BUCKET_61_90


def test_boundary_overdue_91_is_90_plus() -> None:
    """overdue_days == 91 → 90_PLUS."""
    result = _ageing(as_of_date=datetime.date(2025, 5, 2))
    assert result.overdue_days == 91
    assert result.bucket == AgeingBucket.BUCKET_90_PLUS


def test_boundary_overdue_365_is_90_plus() -> None:
    """Deep overdue (365 days) → 90_PLUS."""
    # due_date = 2025-01-31; +365 days = 2026-01-31
    result = _ageing(as_of_date=datetime.date(2026, 1, 31))
    assert result.overdue_days == 365
    assert result.bucket == AgeingBucket.BUCKET_90_PLUS


# ---------------------------------------------------------------------------
# 10–12: credit_days edge cases
# ---------------------------------------------------------------------------


def test_credit_days_zero_due_equals_invoice_date() -> None:
    """credit_days=0: due_date == invoice_date (immediate payment)."""
    invoice_date = datetime.date(2025, 6, 15)
    result = compute_ageing(
        invoice_date=invoice_date,
        credit_days=0,
        as_of_date=datetime.date(2025, 6, 20),  # 5 days after invoice / due
    )
    assert result.due_date == invoice_date
    assert result.overdue_days == 5
    assert result.bucket == AgeingBucket.BUCKET_0_30


def test_credit_days_30() -> None:
    """credit_days=30: due_date == invoice_date + 30 days."""
    invoice_date = datetime.date(2025, 3, 1)
    result = compute_ageing(
        invoice_date=invoice_date,
        credit_days=30,
        as_of_date=datetime.date(2025, 3, 31),  # exactly due
    )
    assert result.due_date == datetime.date(2025, 3, 31)
    assert result.overdue_days == 0
    assert result.bucket == AgeingBucket.BUCKET_0_30


def test_credit_days_365_long_credit() -> None:
    """credit_days=365: due_date == invoice_date + 365 days."""
    invoice_date = datetime.date(2025, 1, 1)
    result = compute_ageing(
        invoice_date=invoice_date,
        credit_days=365,
        as_of_date=datetime.date(2025, 1, 1),  # same day as invoice (not due yet)
    )
    assert result.due_date == datetime.date(2026, 1, 1)
    assert result.overdue_days < 0
    assert result.bucket == AgeingBucket.NOT_DUE


# ---------------------------------------------------------------------------
# 13: as_of_date == invoice_date, credit_days=30 → NOT_DUE
# ---------------------------------------------------------------------------


def test_as_of_equals_invoice_date_with_30_day_credit() -> None:
    """as_of_date == invoice_date, credit_days=30 → due_date is in the future → NOT_DUE."""
    invoice_date = datetime.date(2025, 4, 1)
    result = compute_ageing(
        invoice_date=invoice_date,
        credit_days=30,
        as_of_date=invoice_date,  # same day
    )
    assert result.due_date == datetime.date(2025, 5, 1)
    assert result.overdue_days == -30
    assert result.bucket == AgeingBucket.NOT_DUE


# ---------------------------------------------------------------------------
# 14: as_of_date < invoice_date (backdated snapshot)
# ---------------------------------------------------------------------------


def test_as_of_date_before_invoice_date() -> None:
    """as_of_date < invoice_date (backdated snapshot) → very negative overdue_days → NOT_DUE."""
    invoice_date = datetime.date(2025, 12, 31)
    as_of_date = datetime.date(2025, 1, 1)  # 364 days before invoice
    result = compute_ageing(
        invoice_date=invoice_date,
        credit_days=30,
        as_of_date=as_of_date,
    )
    # due_date = 2025-12-31 + 30d = 2026-01-30
    # overdue_days = (2025-01-01 - 2026-01-30).days = -394
    assert result.due_date == datetime.date(2026, 1, 30)
    assert result.overdue_days == -394
    assert result.bucket == AgeingBucket.NOT_DUE


# ---------------------------------------------------------------------------
# 15: Negative credit_days → ValueError
# ---------------------------------------------------------------------------


def test_negative_credit_days_raises_value_error() -> None:
    """credit_days < 0 must raise ValueError with a clear message."""
    with pytest.raises(ValueError, match="credit_days must be >= 0"):
        compute_ageing(
            invoice_date=datetime.date(2025, 1, 1),
            credit_days=-1,
            as_of_date=datetime.date(2025, 2, 1),
        )


def test_very_negative_credit_days_raises_value_error() -> None:
    """Even a very negative credit_days must raise ValueError."""
    with pytest.raises(ValueError, match="credit_days must be >= 0"):
        compute_ageing(
            invoice_date=datetime.date(2025, 1, 1),
            credit_days=-365,
            as_of_date=datetime.date(2025, 2, 1),
        )


# ---------------------------------------------------------------------------
# 16: Non-date inputs → TypeError
# ---------------------------------------------------------------------------


def test_string_invoice_date_raises_type_error() -> None:
    """Passing a string as invoice_date raises TypeError."""
    bad: object = "2025-01-01"
    with pytest.raises(TypeError, match="invoice_date must be datetime.date"):
        compute_ageing(
            invoice_date=bad,
            credit_days=30,
            as_of_date=datetime.date(2025, 2, 1),
        )


def test_datetime_invoice_date_raises_type_error() -> None:
    """Passing datetime.datetime as invoice_date raises TypeError (not a subclass trap)."""
    bad: object = datetime.datetime(2025, 1, 1, 12, 0)
    with pytest.raises(TypeError, match="invoice_date must be datetime.date"):
        compute_ageing(
            invoice_date=bad,
            credit_days=30,
            as_of_date=datetime.date(2025, 2, 1),
        )


def test_none_invoice_date_raises_type_error() -> None:
    """Passing None as invoice_date raises TypeError."""
    bad: object = None
    with pytest.raises(TypeError, match="invoice_date must be datetime.date"):
        compute_ageing(
            invoice_date=bad,
            credit_days=30,
            as_of_date=datetime.date(2025, 2, 1),
        )


def test_string_as_of_date_raises_type_error() -> None:
    """Passing a string as as_of_date raises TypeError."""
    bad: object = "2025-02-01"
    with pytest.raises(TypeError, match="as_of_date must be datetime.date"):
        compute_ageing(
            invoice_date=datetime.date(2025, 1, 1),
            credit_days=30,
            as_of_date=bad,
        )


def test_datetime_as_of_date_raises_type_error() -> None:
    """Passing datetime.datetime as as_of_date raises TypeError."""
    bad: object = datetime.datetime(2025, 2, 1, 0, 0)
    with pytest.raises(TypeError, match="as_of_date must be datetime.date"):
        compute_ageing(
            invoice_date=datetime.date(2025, 1, 1),
            credit_days=30,
            as_of_date=bad,
        )


# ---------------------------------------------------------------------------
# 17: Determinism with freezegun
# ---------------------------------------------------------------------------


@freeze_time("2030-01-01")
def test_determinism_unaffected_by_frozen_time() -> None:
    """Result must match a hard-coded expected value even with time frozen to 2030.

    This proves compute_ageing never calls datetime.today() / datetime.now().
    The frozen wall clock (2030-01-01) is intentionally far from the test dates
    so any accidental call to today() would produce a clearly wrong result.
    """
    # Use historical dates — nothing close to 2030.
    invoice_date = datetime.date(2024, 6, 1)
    credit_days = 30
    as_of_date = datetime.date(2024, 9, 1)  # 62 days after due_date (2024-07-01)

    result = compute_ageing(
        invoice_date=invoice_date,
        credit_days=credit_days,
        as_of_date=as_of_date,
    )

    # If the function used today() it would use 2030-01-01 (frozen) and give a
    # wildly different overdue_days.  Asserting the exact values proves it doesn't.
    assert result.due_date == datetime.date(2024, 7, 1)
    assert result.overdue_days == 62
    assert result.bucket == AgeingBucket.BUCKET_61_90


# ---------------------------------------------------------------------------
# 18: AgeingResult is frozen (immutable)
# ---------------------------------------------------------------------------


def test_ageing_result_is_frozen() -> None:
    """Setting an attribute on AgeingResult must raise ValidationError (frozen model)."""
    result = compute_ageing(
        invoice_date=datetime.date(2025, 1, 1),
        credit_days=30,
        as_of_date=datetime.date(2025, 3, 5),
    )
    with pytest.raises(ValidationError):
        result.bucket = AgeingBucket.NOT_DUE  # noqa: E501  # intentional: assignment to frozen model raises at runtime


# ---------------------------------------------------------------------------
# 19: JSON round-trip — due_date as ISO string
# ---------------------------------------------------------------------------


def test_ageing_result_json_round_trip() -> None:
    """AgeingResult.model_dump_json must produce valid JSON with due_date as ISO string."""
    result = compute_ageing(
        invoice_date=datetime.date(2025, 1, 1),
        credit_days=30,
        as_of_date=datetime.date(2025, 3, 3),  # overdue_days=31
    )

    json_str = result.model_dump_json()
    data = json.loads(json_str)

    assert data["due_date"] == "2025-01-31"
    assert data["overdue_days"] == 31
    assert data["bucket"] == "31_60"


# ---------------------------------------------------------------------------
# 20: AgeingBucket enum values match spec §2 D6 exactly
# ---------------------------------------------------------------------------


def test_ageing_bucket_enum_values_match_spec() -> None:
    """Each AgeingBucket enum member must have the exact string value from spec §2 D6.

    StrEnum inherits from str, so the .value IS the string.  We compare via
    .value to avoid mypy's Literal non-overlap check on direct == comparisons.
    str() wrapping also works (StrEnum.__str__ returns the value).
    """
    assert AgeingBucket.NOT_DUE.value == "NOT_DUE"
    assert AgeingBucket.BUCKET_0_30.value == "0_30"
    assert AgeingBucket.BUCKET_31_60.value == "31_60"
    assert AgeingBucket.BUCKET_61_90.value == "61_90"
    assert AgeingBucket.BUCKET_90_PLUS.value == "90_PLUS"

    # str() round-trip: StrEnum.__str__ must return the value, not "ClassName.MEMBER"
    assert str(AgeingBucket.NOT_DUE) == "NOT_DUE"
    assert str(AgeingBucket.BUCKET_0_30) == "0_30"
    assert str(AgeingBucket.BUCKET_31_60) == "31_60"
    assert str(AgeingBucket.BUCKET_61_90) == "61_90"
    assert str(AgeingBucket.BUCKET_90_PLUS) == "90_PLUS"


# ---------------------------------------------------------------------------
# Bonus: __init__.py re-exports work
# ---------------------------------------------------------------------------


def test_services_package_re_exports() -> None:
    """Public names must be importable directly from app.services."""
    assert ExportedBucket is AgeingBucket
    assert ExportedResult is AgeingResult
    assert exported_compute_ageing is compute_ageing


def test_services_package_exports_all_names() -> None:
    """app.services.__all__ must include the three public names."""
    import app.services as pkg

    for name in ["AgeingBucket", "AgeingResult", "compute_ageing"]:
        assert hasattr(pkg, name), f"app.services missing export: {name}"
