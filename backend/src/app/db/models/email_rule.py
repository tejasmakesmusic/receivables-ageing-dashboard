"""EmailRule — per-rule-type recipient list, schedule, and active flag (Task A.3).

ADMIN can edit via PATCH /admin/email-rules/{id} without code changes.
Services (digest, nudge, publish) read recipients from this table at enqueue
time; if no row exists (post-seed that should never happen), they fall back to
role-based discovery to avoid breakage.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class EmailRule(UUIDPrimaryKeyMixin, Base):
    """One row per rule_type — edited by ADMIN to control notification routing."""

    __tablename__ = "email_rules"
    __table_args__ = (
        CheckConstraint(
            "rule_type IN ('DAILY_DIGEST', 'WEEKLY_DEFAULT_CP_NUDGE', 'PUBLISH_NOTIF')",
            name="ck_email_rules_rule_type",
        ),
        CheckConstraint(
            "entity_filter IN ('IND', 'UAE', 'ALL')",
            name="ck_email_rules_entity_filter",
        ),
    )

    rule_type: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    recipients_json: Mapped[list[Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'[]'::jsonb"),
    )
    cron_schedule: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.text("true")
    )
    entity_filter: Mapped[str | None] = mapped_column(String(8), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    updater: Mapped[User | None] = relationship(
        "User", foreign_keys=[updated_by], lazy="select"
    )

    def __repr__(self) -> str:
        return (
            f"<EmailRule id={self.id} rule_type={self.rule_type} "
            f"is_active={self.is_active}>"
        )
