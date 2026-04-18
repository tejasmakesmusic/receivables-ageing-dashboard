"""FX conversion service — pinned by invoice_date (spec §7, D15).

Public interface::

    lookup_rate(from_ccy, to_ccy, invoice_date, db) -> Decimal | None
    convert_to_inr(amount, source_currency, invoice_date, db) -> Decimal
    MissingFxRateError — raised when no rate applies

Design decisions:
- Rates are pinned by invoice_date, NEVER by upload_date or datetime.today().
- Lookup: WHERE from_ccy=:f AND to_ccy=:t AND effective_from <= :invoice_date
  ORDER BY effective_from DESC LIMIT 1.  effective_to is always NULL (D15).
- INR→INR is a no-op (returns amount unchanged, no DB query needed).
- MissingFxRateError carries structured fields so callers can return a
  422 with code FX_RATE_MISSING pointing to /admin/fx-rates.
- Rate cache: within one Python call the caller can build a dict of
  {(from_ccy, to_ccy, invoice_date): rate} to avoid repeated lookups.
  This module does not cache across requests (no state).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

import structlog
from fastapi import HTTPException
from sqlalchemy import select

from app.db.models.fx_rate import FxRate

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = structlog.get_logger(__name__)


class MissingFxRateError(Exception):
    """Raised when no FX rate covers invoice_date for a currency pair.

    Attributes:
        from_ccy:     source currency code (e.g. 'AED')
        to_ccy:       target currency code (e.g. 'INR')
        invoice_date: the date for which no rate was found
    """

    def __init__(self, from_ccy: str, to_ccy: str, invoice_date: date) -> None:
        self.from_ccy = from_ccy
        self.to_ccy = to_ccy
        self.invoice_date = invoice_date
        super().__init__(f"No FX rate found for {from_ccy}→{to_ccy} covering {invoice_date}")

    def to_http_422(self) -> HTTPException:
        """Convert to a structured 422 HTTPException for API callers."""
        return HTTPException(
            status_code=422,
            detail={
                "code": "FX_RATE_MISSING",
                "from_ccy": self.from_ccy,
                "to_ccy": self.to_ccy,
                "invoice_date": self.invoice_date.isoformat(),
                "hint": "Seed a rate at /config/fx-rates",
            },
        )


def lookup_rate(
    from_ccy: str,
    to_ccy: str,
    invoice_date: date,
    db: Session,
) -> Decimal | None:
    """Fetch the applicable FX rate for the given currency pair and invoice date.

    Parameters
    ----------
    from_ccy:     source currency (e.g. 'AED')
    to_ccy:       target currency (e.g. 'INR')
    invoice_date: date to pin the rate to (spec §7 rule 3)
    db:           SQLAlchemy session

    Returns
    -------
    Decimal rate if found, None if no applicable rate exists.

    Notes
    -----
    - Finds the most recent rate whose effective_from <= invoice_date.
    - effective_to is always NULL per D15; the column is ignored here.
    - No-op path: if from_ccy == to_ccy, returns Decimal('1').
    """
    if from_ccy == to_ccy:
        return Decimal("1")

    row = db.scalar(
        select(FxRate)
        .where(
            FxRate.from_ccy == from_ccy,
            FxRate.to_ccy == to_ccy,
            FxRate.effective_from <= invoice_date,
        )
        .order_by(FxRate.effective_from.desc())
        .limit(1)
    )

    if row is None:
        return None

    return row.rate


def convert_to_inr(
    amount: Decimal,
    source_currency: str,
    invoice_date: date,
    db: Session,
) -> Decimal:
    """Convert an amount to INR using the rate pinned by invoice_date.

    Parameters
    ----------
    amount:          amount in source_currency
    source_currency: e.g. 'AED' or 'INR'
    invoice_date:    used to pin the applicable rate (spec §7)
    db:              SQLAlchemy session

    Returns
    -------
    Decimal amount in INR (rounded to 2 dp).

    Raises
    ------
    MissingFxRateError:
        If no rate covers invoice_date for the currency pair.
    """
    if source_currency == "INR":
        return amount

    rate = lookup_rate(
        from_ccy=source_currency,
        to_ccy="INR",
        invoice_date=invoice_date,
        db=db,
    )

    if rate is None:
        raise MissingFxRateError(
            from_ccy=source_currency,
            to_ccy="INR",
            invoice_date=invoice_date,
        )

    result = (amount * rate).quantize(Decimal("0.01"))
    return result


def build_rate_cache(
    invoices: list[dict],
    source_currency: str,
    db: Session,
) -> dict[tuple[str, str, date], Decimal | None]:
    """Pre-fetch all unique (from_ccy, to_ccy, invoice_date) rates in one pass.

    Useful for dashboard/consolidated view where we need rates for many
    invoices. Returns a dict keyed by (from_ccy, to_ccy, invoice_date).

    Parameters
    ----------
    invoices:        list of dicts with 'invoice_date' (date) and 'currency' keys
    source_currency: the currency to convert from
    db:              SQLAlchemy session
    """
    cache: dict[tuple[str, str, date], Decimal | None] = {}

    if source_currency == "INR":
        return cache  # no-op

    unique_dates: set[date] = set()
    for inv in invoices:
        inv_date = inv.get("invoice_date")
        if isinstance(inv_date, date):
            unique_dates.add(inv_date)

    for inv_date in unique_dates:
        key = (source_currency, "INR", inv_date)
        cache[key] = lookup_rate(
            from_ccy=source_currency,
            to_ccy="INR",
            invoice_date=inv_date,
            db=db,
        )

    return cache
