"""FX rate — AED→INR (etc.), strictly immutable after create (spec D15).

Immutability is enforced belt-and-suspenders:

1. ORM ``before_flush`` hook in ``app/db/events.py`` — rejects dirty
   FxRate instances at the SQLAlchemy session layer so the error surfaces
   with a Python stack trace in application code.
2. Postgres ``BEFORE UPDATE`` trigger ``fx_rates_no_update`` (installed
   by migration ``0001_initial``) — catches writes that bypass the ORM
   (raw SQL, ``session.execute(update(...))``, psql shell, etc.) and
   raises ``restrict_violation`` at the DB level.

Additionally, a partial unique index ``ix_fx_rates_pair_open`` on
``(from_ccy, to_ccy) WHERE effective_to IS NULL`` enforces at the DB
level that at most one currently-open row exists per currency pair.
Under the total-immutability contract (§7 rule 4) ``effective_to``
always stays NULL; the column + partial index are retained as an
escape hatch if the contract is ever relaxed.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class FxRateSource(StrEnum):
    # IMPORTANT — adding or renaming a value here requires a HAND-WRITTEN
    # Alembic migration that emits `ALTER TYPE fx_rate_source ADD VALUE '...'`.
    # `alembic revision --autogenerate` does NOT detect changes to native
    # Postgres enum types and will silently produce a no-op migration.
    # See also Role in app/core/rbac.py for the same caveat.
    MANUAL = "MANUAL"
    API = "API"


class FxRate(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "fx_rates"
    __table_args__ = (
        UniqueConstraint("from_ccy", "to_ccy", "effective_from", name="uq_fx_rate_triple"),
    )

    from_ccy: Mapped[str] = mapped_column(String(3), nullable=False)
    to_ccy: Mapped[str] = mapped_column(String(3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[FxRateSource] = mapped_column(
        Enum(FxRateSource, name="fx_rate_source", native_enum=True),
        nullable=False,
    )
    # Only created_at (no updated_at) because row is immutable.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    creator: Mapped[User | None] = relationship("User", lazy="joined")
