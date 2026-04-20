"""ExceptionTag — AR exception tracking per invoice (spec §3).

status values:
  ACTIVE       — open exception, not yet resolved
  RESOLVED     — manually resolved by a user
  AUTO_RESOLVED — auto-resolved because the invoice was SETTLED in a publish
                 (spec §13 #1)

``resolution_note`` on AUTO_RESOLVED records the snapshot that triggered it.
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
    String,  # noqa: F401
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.exception_bucket_type import ExceptionBucketType
    from app.db.models.invoice import Invoice
    from app.db.models.user import User


class ExceptionTag(UUIDPrimaryKeyMixin, Base):
    """An AR exception tag on a specific invoice (spec §3)."""

    __tablename__ = "exception_tags"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE', 'RESOLVED', 'AUTO_RESOLVED')",
            name="status",
        ),
        CheckConstraint(
            "excluded_reason IN ('LEGAL_HOLD', 'NEGOTIATION', 'AGREED_WRITE_OFF', 'OTHER')",
            name="ck_exception_tags_excluded_reason",
        ),
        # spec §3: index (invoice_id, status)
        Index("ix_exception_tags_invoice_status", "invoice_id", "status"),
    )

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=False,
    )
    bucket_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exception_bucket_types.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    tagged_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    tagged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    expected_resolution_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 'ACTIVE' | 'RESOLVED' | 'AUTO_RESOLVED'
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sa.text("'ACTIVE'"),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Exclusion fields (orthogonal to status — Task A.1)
    excluded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    excluded_reason: Mapped[str | None] = mapped_column(
        sa.String(64), nullable=True
    )  # LEGAL_HOLD | NEGOTIATION | AGREED_WRITE_OFF | OTHER
    excluded_reason_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    excluded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    invoice: Mapped[Invoice] = relationship("Invoice", lazy="select")
    bucket_type: Mapped[ExceptionBucketType] = relationship("ExceptionBucketType", lazy="select")
    tagger: Mapped[User] = relationship("User", foreign_keys=[tagged_by], lazy="select")
    resolver: Mapped[User | None] = relationship("User", foreign_keys=[resolved_by], lazy="select")
    excluder: Mapped[User | None] = relationship("User", foreign_keys=[excluded_by], lazy="select")

    def __repr__(self) -> str:
        return f"<ExceptionTag id={self.id} invoice={self.invoice_id} status={self.status}>"
