"""Ageing calc — pure function, no DB, no network, no clock reads (spec §6).

``compute_ageing`` is deterministic: it takes ``as_of_date`` explicitly from
the caller (the snapshot's ``as_of_date`` field).  It never calls
``datetime.today()``, ``datetime.now()``, or ``datetime.utcnow()``.
Historical snapshots must be exactly reproducible.

Type discipline
---------------
``invoice_date`` and ``as_of_date`` must be ``datetime.date`` instances.
Passing ``datetime.datetime`` raises ``TypeError`` — callers (parsers in M2,
ingestion in M3) already produce ``date`` values, so this is a defensive
check that catches accidental upcasting.

``credit_days`` must be >= 0.  0 is valid (immediate payment = due today).
Negative values raise ``ValueError`` — the M3 caller will have validated
via ``StagedCreditPeriod.credit_days >= 0``, but this function defends itself.
"""

from __future__ import annotations

from datetime import date, timedelta
from enum import StrEnum

from pydantic import BaseModel, ConfigDict

# Bucket boundary constants (spec §2 D6 / §6) — avoids PLR2004 magic-number lint
_BUCKET_0_30_MAX: int = 30
_BUCKET_31_60_MAX: int = 60
_BUCKET_61_90_MAX: int = 90


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class AgeingBucket(StrEnum):
    """Spec §2 D6 bucket identifiers — string values must match exactly."""

    NOT_DUE = "NOT_DUE"
    BUCKET_0_30 = "0_30"
    BUCKET_31_60 = "31_60"
    BUCKET_61_90 = "61_90"
    BUCKET_90_PLUS = "90_PLUS"


# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------


class AgeingResult(BaseModel):
    """Immutable result of a single ageing computation (spec §6)."""

    model_config = ConfigDict(frozen=True)

    due_date: date
    overdue_days: int
    bucket: AgeingBucket


# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------


def compute_ageing(
    invoice_date: date,
    credit_days: int,
    as_of_date: date,
) -> AgeingResult:
    """Compute ageing bucket for one invoice.

    Parameters
    ----------
    invoice_date:
        Date the invoice was raised.  Must be ``datetime.date`` — passing
        ``datetime.datetime`` raises ``TypeError``.
    credit_days:
        Number of calendar days of credit granted.  Must be >= 0.
        0 = immediate payment (due on invoice_date itself).
    as_of_date:
        Reference date for ageing — taken from the snapshot, never from the
        system clock.  Must be ``datetime.date``.

    Returns
    -------
    AgeingResult
        Frozen pydantic model with ``due_date``, ``overdue_days``, ``bucket``.

    Raises
    ------
    TypeError
        If ``invoice_date`` or ``as_of_date`` is not ``datetime.date``
        (e.g. if a ``datetime.datetime`` is passed by mistake).
    ValueError
        If ``credit_days`` is negative.
    """
    # --- type guards: reject non-date and datetime.datetime subclass ------
    # datetime.datetime IS a subclass of datetime.date, so isinstance alone is
    # insufficient — we use exact type() equality to reject any subclass.
    # This also rejects str, None, int, etc. since they are not date at all.
    if type(invoice_date) is not date:
        raise TypeError(f"invoice_date must be datetime.date, got {type(invoice_date).__name__!r}")
    if type(as_of_date) is not date:
        raise TypeError(f"as_of_date must be datetime.date, got {type(as_of_date).__name__!r}")

    # --- credit_days guard -----------------------------------------------
    if credit_days < 0:
        raise ValueError(
            f"credit_days must be >= 0 (got {credit_days!r}). "
            "Negative credit periods are not supported."
        )

    # --- core computation (spec §6 verbatim) ------------------------------
    due_date = invoice_date + timedelta(days=credit_days)
    overdue_days = (as_of_date - due_date).days

    if overdue_days < 0:
        bucket = AgeingBucket.NOT_DUE
    elif overdue_days <= _BUCKET_0_30_MAX:
        bucket = AgeingBucket.BUCKET_0_30
    elif overdue_days <= _BUCKET_31_60_MAX:
        bucket = AgeingBucket.BUCKET_31_60
    elif overdue_days <= _BUCKET_61_90_MAX:
        bucket = AgeingBucket.BUCKET_61_90
    else:
        bucket = AgeingBucket.BUCKET_90_PLUS

    return AgeingResult(due_date=due_date, overdue_days=overdue_days, bucket=bucket)
