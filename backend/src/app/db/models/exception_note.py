"""ExceptionNote — note/comment timeline per exception tag (M5 extension)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.exception_tag import ExceptionTag
    from app.db.models.user import User


class ExceptionNote(UUIDPrimaryKeyMixin, Base):
    """Persistent thread notes attached to an exception tag."""

    __tablename__ = "exception_notes"

    exception_tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exception_tags.id", ondelete="CASCADE"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )

    # Relationships
    exception_tag: Mapped[ExceptionTag] = relationship(
        "ExceptionTag",
        lazy="select",
    )
    author: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[author_user_id],
        lazy="joined",
    )

    def __repr__(self) -> str:
        return f"<ExceptionNote id={self.id} exception_tag={self.exception_tag_id}>"
