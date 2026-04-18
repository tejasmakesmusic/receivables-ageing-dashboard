"""Credit period config — versioned credit-days per canonical party (spec §3 + §4.3).

Each row is a "version" of the credit term for a given party.
The open (current) version has ``valid_to = NULL``.  A partial unique
index enforces at most one open row per canonical party.

When a new credit period is uploaded (§4.3 rule 5):
  1. The prior open row is closed: ``valid_to = new.valid_from - 1 day``.
  2. A new row is inserted with ``valid_to = NULL``.

``credit_days >= 0`` is enforced by a CHECK — 0 is valid (immediate
payment terms).

Column naming follows spec §3 verbatim:
  - spec uses ``days`` (not ``credit_days``) in the DDL comment
  - task brief uses ``credit_days``
  - spec §3 DDL snippet: ``days INT``, ``updated_by``, ``updated_at``
  Decision: follow spec §3 DDL exactly — use ``days`` / ``updated_by`` /
  ``updated_at``.  The ORM attribute is ``days`` for SELECT consistency.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.party import PartyCanonical
    from app.db.models.user import User


class CreditPeriodConfig(UUIDPrimaryKeyMixin, Base):
    """Versioned credit term per canonical party (spec §3 credit_period_config).

    Partial unique index ``ix_credit_period_config_open`` enforces the
    invariant that at most one row per canonical_id has ``valid_to IS NULL``
    (i.e. is currently active).  This is defined in the Alembic migration
    because SQLAlchemy's UniqueConstraint cannot express partial indexes.
    """

    __tablename__ = "credit_period_config"
    __table_args__ = (
        # Short name: convention → ck_credit_period_config_days_non_negative
        CheckConstraint(
            "days >= 0",
            name="days_non_negative",
        ),
        # Partial unique index — at most one open row per canonical (valid_to IS NULL).
        # Declared in the Alembic migration with postgresql_where; listed here too
        # so the ORM __table__ metadata reflects it for test introspection.
        Index(
            "ix_credit_period_config_open",
            "canonical_id",
            unique=True,
            postgresql_where=sa.text("valid_to IS NULL"),
        ),
        # Compound index for latest-lookup: (canonical_id, valid_from DESC)
        Index(
            "ix_credit_period_config_canonical_valid_from",
            "canonical_id",
            "valid_from",
        ),
    )

    canonical_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("parties_canonical.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Spec §3 DDL name is ``days`` (not ``credit_days``).
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    reason_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    # NULL = currently active.  Closed by next upsert.
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    canonical: Mapped[PartyCanonical] = relationship("PartyCanonical", lazy="select")
    updater: Mapped[User] = relationship("User", foreign_keys=[updated_by], lazy="select")

    def __repr__(self) -> str:
        return (
            f"<CreditPeriodConfig id={self.id} "
            f"canonical={self.canonical_id} days={self.days} "
            f"valid_from={self.valid_from} valid_to={self.valid_to}>"
        )
