"""ReconciliationEntry — one row per snapshot, tracks AR reconciliation (spec §3 + D19).

status values:
  UNRECONCILED — tally_xero_closing_ar has not been entered yet
  MATCHED      — abs(delta) <= 100 (₹100 tolerance per spec)
  MISMATCHED   — delta exists but exceeds tolerance

delta formula (D19):
  delta = dashboard_ar + exception_bucket_total - tally_xero_closing_ar

ADMIN-only writes (temporary decision pending D19 vs §9 resolution).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.snapshot import Snapshot
    from app.db.models.user import User


class ReconciliationEntry(UUIDPrimaryKeyMixin, Base):
    """AR reconciliation record per snapshot (spec §3 + D19)."""

    __tablename__ = "reconciliation_entries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('MATCHED', 'MISMATCHED', 'UNRECONCILED')",
            name="status",
        ),
        Index("ix_reconciliation_entries_snapshot_id", "snapshot_id"),
    )

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("snapshots.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    dashboard_ar: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    exception_bucket_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    # Per-bucket breakdown: {bucket_code: total_outstanding}
    exception_bucket_breakdown: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )
    # NULL until user enters a value
    tally_xero_closing_ar: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    # NULL until tally_xero_closing_ar is set
    delta: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    # 'UNRECONCILED' | 'MATCHED' | 'MISMATCHED'
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sa.text("'UNRECONCILED'"),
    )
    entered_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    snapshot: Mapped[Snapshot] = relationship("Snapshot", lazy="select")
    entered_by_user: Mapped[User | None] = relationship(
        "User", foreign_keys=[entered_by], lazy="select"
    )

    def __repr__(self) -> str:
        return (
            f"<ReconciliationEntry id={self.id} "
            f"snapshot={self.snapshot_id} "
            f"status={self.status}>"
        )
