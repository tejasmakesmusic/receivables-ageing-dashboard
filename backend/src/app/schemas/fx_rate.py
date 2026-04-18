"""FX rate schemas — GET/POST /config/fx-rates (M6 A4)."""

from __future__ import annotations

from datetime import date, datetime  # noqa: TCH003
from decimal import Decimal
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict, field_validator

_CCY_LENGTH = 3


class FxRateCreateRequest(BaseModel):
    from_ccy: str
    to_ccy: str
    rate: Decimal
    valid_from: date
    notes: str | None = None

    @field_validator("rate")
    @classmethod
    def rate_positive(cls, v: Decimal) -> Decimal:
        if v <= Decimal("0"):
            raise ValueError("rate must be positive")
        return v

    @field_validator("from_ccy", "to_ccy")
    @classmethod
    def ccy_length(cls, v: str) -> str:
        v = v.upper().strip()
        if len(v) != _CCY_LENGTH:
            raise ValueError("currency code must be 3 characters (ISO 4217)")
        return v


class FxRateRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    from_ccy: str
    to_ccy: str
    rate: Decimal
    valid_from: date
    source: str
    created_at: datetime
    created_by_email: str | None


class FxRateListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[FxRateRow]
    total: int
    page: int
    page_size: int
