"""Entity — a legal entity with its own ledger (EMB_IN, MANTARAV_UAE)."""

from __future__ import annotations

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Entity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "entities"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False)  # ISO-2
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)  # INR, AED
    # Nullable — admin sets default credit period per entity in M3 (spec D8).
    default_credit_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def __repr__(self) -> str:
        return f"<Entity {self.code}>"
