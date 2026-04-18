"""Unit tests for fx_conversion service (M4 Group B).

Tests lookup_rate(), convert_to_inr(), MissingFxRateError, and
the build_rate_cache helper. Uses in-process DB via db_session fixture.
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.db.models.fx_rate import FxRate
from app.db.models.user import User
from app.services.fx_conversion import (
    MissingFxRateError,
    build_rate_cache,
    convert_to_inr,
    lookup_rate,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_id(db_session: Session) -> uuid.UUID:
    user = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert user is not None
    return user.id


def _seed_rate(
    db_session: Session,
    from_ccy: str,
    to_ccy: str,
    rate: Decimal,
    effective_from: date,
    effective_to: date | None = None,
) -> None:
    fx = FxRate(
        from_ccy=from_ccy,
        to_ccy=to_ccy,
        rate=rate,
        effective_from=effective_from,
        effective_to=effective_to,
        source="MANUAL",
        created_by=_admin_id(db_session),
    )
    db_session.add(fx)
    db_session.flush()


# ---------------------------------------------------------------------------
# lookup_rate tests
# ---------------------------------------------------------------------------


def test_lookup_rate_returns_rate_for_exact_date(db_session: Session) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("22.50"), date(2026, 1, 1))
    result = lookup_rate("AED", "INR", date(2026, 1, 15), db_session)
    assert result == Decimal("22.50")


def test_lookup_rate_pins_by_invoice_date_not_today(db_session: Session) -> None:
    """Rate on 2026-01-01 applies to invoice_date 2026-01-15, not a newer rate."""
    _seed_rate(db_session, "AED", "INR", Decimal("22.50"), date(2026, 1, 1), effective_to=date(2026, 1, 31))
    _seed_rate(db_session, "AED", "INR", Decimal("23.00"), date(2026, 2, 1))
    # Invoice dated 2026-01-15 → must use the 2026-01-01 rate
    result = lookup_rate("AED", "INR", date(2026, 1, 15), db_session)
    assert result == Decimal("22.50")


def test_lookup_rate_uses_most_recent_rate_on_or_before_invoice_date(
    db_session: Session,
) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("21.00"), date(2025, 6, 1), effective_to=date(2025, 12, 31))
    _seed_rate(db_session, "AED", "INR", Decimal("22.50"), date(2026, 1, 1), effective_to=date(2026, 3, 31))
    _seed_rate(db_session, "AED", "INR", Decimal("24.00"), date(2026, 4, 1))
    # Invoice dated exactly on the 2026-01-01 boundary
    result = lookup_rate("AED", "INR", date(2026, 1, 1), db_session)
    assert result == Decimal("22.50")


def test_lookup_rate_returns_none_when_no_rate(db_session: Session) -> None:
    result = lookup_rate("AED", "INR", date(2020, 1, 1), db_session)
    assert result is None


def test_lookup_rate_same_currency_returns_one(db_session: Session) -> None:
    """INR → INR is always 1 (no DB query needed)."""
    result = lookup_rate("INR", "INR", date(2026, 1, 1), db_session)
    assert result == Decimal("1")


def test_lookup_rate_ignores_future_rates(db_session: Session) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("25.00"), date(2026, 12, 1))
    # Invoice dated before the rate's effective_from → no applicable rate
    result = lookup_rate("AED", "INR", date(2026, 1, 1), db_session)
    assert result is None


# ---------------------------------------------------------------------------
# MissingFxRateError tests
# ---------------------------------------------------------------------------


def test_missing_fx_rate_error_attributes() -> None:
    err = MissingFxRateError("AED", "INR", date(2026, 1, 15))
    assert err.from_ccy == "AED"
    assert err.to_ccy == "INR"
    assert err.invoice_date == date(2026, 1, 15)


def test_missing_fx_rate_error_to_http_422() -> None:
    err = MissingFxRateError("AED", "INR", date(2026, 1, 15))
    exc = err.to_http_422()
    assert isinstance(exc, HTTPException)
    assert exc.status_code == 422
    assert exc.detail["code"] == "FX_RATE_MISSING"
    assert exc.detail["from_ccy"] == "AED"
    assert exc.detail["to_ccy"] == "INR"
    assert "2026-01-15" in exc.detail["invoice_date"]


# ---------------------------------------------------------------------------
# convert_to_inr tests
# ---------------------------------------------------------------------------


def test_convert_to_inr_inr_passthrough(db_session: Session) -> None:
    """INR amounts pass through unchanged."""
    result = convert_to_inr(Decimal("1000"), "INR", date(2026, 1, 1), db_session)
    assert result == Decimal("1000")


def test_convert_to_inr_aed_conversion(db_session: Session) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("22.50"), date(2026, 1, 1))
    result = convert_to_inr(Decimal("100"), "AED", date(2026, 1, 15), db_session)
    assert result == Decimal("2250.00")


def test_convert_to_inr_raises_missing_fx_rate(db_session: Session) -> None:
    with pytest.raises(MissingFxRateError) as exc_info:
        convert_to_inr(Decimal("100"), "AED", date(2020, 1, 1), db_session)
    err = exc_info.value
    assert err.from_ccy == "AED"
    assert err.to_ccy == "INR"
    assert err.invoice_date == date(2020, 1, 1)


def test_convert_to_inr_decimal_precision(db_session: Session) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("22.75"), date(2026, 1, 1))
    result = convert_to_inr(Decimal("200"), "AED", date(2026, 1, 15), db_session)
    assert result == Decimal("4550.00")


# ---------------------------------------------------------------------------
# build_rate_cache tests
# ---------------------------------------------------------------------------


def test_build_rate_cache_returns_rates_by_date(db_session: Session) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("22.50"), date(2026, 1, 1), effective_to=date(2026, 1, 31))
    _seed_rate(db_session, "AED", "INR", Decimal("23.00"), date(2026, 2, 1))

    # build_rate_cache expects list of dicts with 'invoice_date' key
    invoices = [
        {"invoice_date": date(2026, 1, 15)},
        {"invoice_date": date(2026, 2, 15)},
    ]
    cache = build_rate_cache(invoices, "AED", db_session)
    assert cache[("AED", "INR", date(2026, 1, 15))] == Decimal("22.50")
    assert cache[("AED", "INR", date(2026, 2, 15))] == Decimal("23.00")


def test_build_rate_cache_deduplicates_dates(db_session: Session) -> None:
    _seed_rate(db_session, "AED", "INR", Decimal("22.50"), date(2026, 1, 1))

    # Three dicts, two on same date
    invoices = [
        {"invoice_date": date(2026, 1, 15)},
        {"invoice_date": date(2026, 1, 15)},
        {"invoice_date": date(2026, 1, 20)},
    ]
    cache = build_rate_cache(invoices, "AED", db_session)
    # Must not error; both unique dates get looked up
    assert ("AED", "INR", date(2026, 1, 15)) in cache
    assert ("AED", "INR", date(2026, 1, 20)) in cache


def test_build_rate_cache_inr_returns_empty(db_session: Session) -> None:
    """For INR source currency, no lookup needed; cache should be empty or trivial."""
    invoices = [{"invoice_date": date(2026, 1, 15)}]
    # Should not raise even if no rates exist; returns empty dict for INR
    cache = build_rate_cache(invoices, "INR", db_session)
    assert isinstance(cache, dict)
