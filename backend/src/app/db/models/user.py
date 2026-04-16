"""User — one row per human who has ever signed in via Google SSO."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.rbac import Role
from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.entity import Entity


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    # citext in Postgres gives case-insensitive uniqueness. We use a CHECK-free
    # plain VARCHAR here and normalize emails to lowercase at insert time in
    # the auth callback — simpler than requiring the citext extension on Neon.
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    google_sub: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="role_enum", native_enum=True),
        nullable=False,
        default=Role.PENDING,
    )
    entity_id_scope: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    entity_scope: Mapped[Entity | None] = relationship("Entity", lazy="joined")

    def __repr__(self) -> str:
        return f"<User {self.email} role={self.role}>"
