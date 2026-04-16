"""AuditLog — append-only ledger of every mutation (spec §9 + CLAUDE.md rule).

Every role change, FX rate create, ingestion upload, rule activation etc.
writes a row here with before/after JSON snapshots.

Immutability is enforced by discipline, not by an ORM event hook (unlike
FxRate/D15). Writes flow exclusively through the `write_audit_log` helper
(Task 21), which is the single documented entry point. No before_flush
guard here because:
  - tests and bootstrap migrations need to seed rows directly
  - future archival/retention jobs need to DELETE old rows
  - admin "redact PII from this row" workflows may need targeted UPDATE
These are all legitimate write paths that a hook would block.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_created_at", "created_at"),)

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Convention: snake_case verb naming the mutation type.
    # Examples: "fx_rate_create", "role_change", "user_activate",
    # "entity_publish". Enforced by write_audit_log in Task 21.
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    # Name of the table `entity_id` points at — e.g. "users", "fx_rates".
    # No FK because the reference is polymorphic; the write helper is
    # responsible for keeping (entity_type, entity_id) pairs coherent.
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    actor: Mapped[User | None] = relationship("User", lazy="joined")
