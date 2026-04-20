"""EmailOutbox — staging table for outbound emails (spec §5 PUBLISH_NOTIF).

M6 SMTP cron drains rows with status='QUEUED'.  Task 5 writes PUBLISH_NOTIF rows
after a successful publish; M6 will add DAILY_DIGEST rows.

recipients_json is intentionally empty ('[]') at publish time — M6 will populate
from email_rules when it processes the row.  This avoids coupling the publish
service to the (M6-defined) rule evaluation logic.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.snapshot import Snapshot


class EmailOutbox(UUIDPrimaryKeyMixin, Base):
    """Queued outbound email row — drained by M6 SMTP cron."""

    __tablename__ = "email_outbox"
    __table_args__ = (
        CheckConstraint(
            "rule_type IN ('DAILY_DIGEST', 'PUBLISH_NOTIF', 'WEEKLY_DEFAULT_CP_NUDGE')",
            name="rule_type",
        ),
        CheckConstraint(
            "status IN ('QUEUED', 'SENT', 'FAILED')",
            name="status",
        ),
        # Hot path for drain cron: filter QUEUED rows by enqueue order
        Index("ix_email_outbox_status_enqueued", "status", "enqueued_at"),
    )

    # 'DAILY_DIGEST' | 'PUBLISH_NOTIF'
    rule_type: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("snapshots.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Populated by M6 drain cron from email_rules; empty at publish time.
    recipients_json: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    # 'QUEUED' | 'SENT' | 'FAILED'
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=sa.text("'QUEUED'"),
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa.text("0"))
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    enqueued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    snapshot: Mapped[Snapshot | None] = relationship("Snapshot", lazy="select")

    def __repr__(self) -> str:
        return f"<EmailOutbox id={self.id} rule_type={self.rule_type} status={self.status}>"
