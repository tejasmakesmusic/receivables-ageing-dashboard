"""FollowUp — follow-up log per invoice or party (spec §3 + S6).

M5 stub: table exists, CRUD endpoints return 501 Not Implemented.
Full implementation deferred to M5 extension.

channel values: EMAIL | CALL | WHATSAPP | MEETING
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.invoice import Invoice
    from app.db.models.party import PartyCanonical
    from app.db.models.user import User


class FollowUp(UUIDPrimaryKeyMixin, Base):
    """Follow-up activity log entry for an invoice or party (spec §3)."""

    __tablename__ = "follow_ups"
    __table_args__ = (
        CheckConstraint(
            "channel IN ('EMAIL', 'CALL', 'WHATSAPP', 'MEETING')",
            name="channel",
        ),
        Index("ix_follow_ups_canonical_id", "canonical_id"),
        Index("ix_follow_ups_invoice_id", "invoice_id"),
    )

    # invoice_id is nullable — follow-up can be at party level without a specific invoice
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=True,
    )
    canonical_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("parties_canonical.id", ondelete="RESTRICT"),
        nullable=False,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    # 'EMAIL' | 'CALL' | 'WHATSAPP' | 'MEETING'
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    contact_person: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_action_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    logged_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    invoice: Mapped[Invoice | None] = relationship("Invoice", lazy="select")
    canonical: Mapped[PartyCanonical] = relationship("PartyCanonical", lazy="select")
    logger: Mapped[User] = relationship("User", foreign_keys=[logged_by], lazy="select")

    def __repr__(self) -> str:
        return f"<FollowUp id={self.id} canonical={self.canonical_id} channel={self.channel}>"
