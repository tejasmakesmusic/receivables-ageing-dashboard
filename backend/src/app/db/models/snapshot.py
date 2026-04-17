"""Snapshot — one upload event per entity, driving the state machine (spec §5).

State machine:
    STAGED  →  PUBLISHED
    STAGED  →  DISCARDED

``upload_file_sha256`` carries a UNIQUE constraint (spec §4.4) so that
re-uploading the same file is rejected at the DB level with a
``UniqueViolation``, surfaced by the upload service as HTTP 409.

``source_hint`` records which parser was used ('TALLY' | 'XERO' |
'CREDIT_PERIOD').  A CHECK constraint enforces the allowed set.

``warnings_acknowledged_json`` holds the list of warning codes
acknowledged by the analyst before publish, each with {code, ack_by,
ack_at}.  The publish gate (§5) verifies every code in
``parse_result_json.warnings`` has a matching entry here.

``published_as`` is NULL on a normal publish; 'OVERRIDE' when an admin
publishes on behalf of an analyst (D17).  The CHECK enforces the two
allowed non-NULL values.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Any

import sqlalchemy as sa
from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.entity import Entity
    from app.db.models.user import User


class Snapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One upload event per entity.  Drives the §5 state machine."""

    __tablename__ = "snapshots"
    __table_args__ = (
        # Short names — the naming convention in base.py prefixes
        # "ck_%(table_name)s_" automatically:
        #   "source_hint" → ck_snapshots_source_hint
        #   "status"      → ck_snapshots_status
        #   "published_as"→ ck_snapshots_published_as
        CheckConstraint(
            "source_hint IN ('TALLY', 'XERO', 'CREDIT_PERIOD')",
            name="source_hint",
        ),
        CheckConstraint(
            "status IN ('STAGED', 'PUBLISHED', 'DISCARDED')",
            name="status",
        ),
        CheckConstraint(
            "published_as IS NULL OR published_as IN ('NORMAL', 'OVERRIDE')",
            name="published_as",
        ),
        UniqueConstraint("upload_file_sha256", name="uq_snapshots_upload_file_sha256"),
        Index("ix_snapshots_entity_status", "entity_id", "status"),
    )

    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # Spec §3: upload_file_path (retained for file-store lookup) + sha256 for
    # duplicate-rejection (spec §4.4).
    upload_file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    upload_file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # Nullable — CREDIT_PERIOD uploads have no logical as-of date (migration 0004).
    as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # 'TALLY' | 'XERO' | 'CREDIT_PERIOD' — enforced by CHECK above.
    source_hint: Mapped[str] = mapped_column(String(32), nullable=False)
    # 'STAGED' | 'PUBLISHED' | 'DISCARDED' — enforced by CHECK above.
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="STAGED")
    # Spec §3 convenience fields populated on publish.
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_outstanding: Mapped[Any | None] = mapped_column(Numeric(18, 2), nullable=True)
    # Full ParseResult.model_dump() captured for audit + staging UI rendering.
    parse_result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    # List of {code, ack_by, ack_at} — publish gate blocks until all warning
    # codes from parse_result_json.warnings are present here.
    warnings_acknowledged_json: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
    )
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    # NULL = not yet published.  'NORMAL' | 'OVERRIDE' when published (D17).
    published_as: Mapped[str | None] = mapped_column(String(16), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    discarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    discarded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    entity: Mapped[Entity] = relationship("Entity", foreign_keys=[entity_id], lazy="select")
    uploader: Mapped[User] = relationship("User", foreign_keys=[uploaded_by], lazy="select")
    publisher: Mapped[User | None] = relationship(
        "User", foreign_keys=[published_by], lazy="select"
    )
    discarder: Mapped[User | None] = relationship(
        "User", foreign_keys=[discarded_by], lazy="select"
    )

    def __repr__(self) -> str:
        return f"<Snapshot id={self.id} entity={self.entity_id} status={self.status}>"
