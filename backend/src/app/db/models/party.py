"""Party master tables: parties_canonical + party_aliases (spec §3).

``PartyCanonical`` is the single source of truth for a counterparty name
within an entity.  Multiple raw names from Tally/Xero can map to the same
canonical via ``PartyAlias`` rows.

Alias ``source`` records where the alias came from:
    'TALLY'  — raw party name from a Tally export
    'XERO'   — raw contact name from a Xero export
    'MANUAL' — analyst typed it in manually

``confidence`` is the RapidFuzz token_sort_ratio score at the time the
alias was first suggested (0-100).  It is informational; the analyst
confirms or rejects the suggestion.  A manually-created alias always gets
confidence=100.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.entity import Entity
    from app.db.models.user import User


class PartyCanonical(UUIDPrimaryKeyMixin, Base):
    """Canonical counterparty master (spec §3 parties_canonical)."""

    __tablename__ = "parties_canonical"
    __table_args__ = (
        UniqueConstraint("entity_id", "name", name="uq_parties_canonical_entity_name"),
        Index("ix_parties_canonical_entity_id", "entity_id"),
    )

    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    entity: Mapped[Entity] = relationship("Entity", lazy="select")
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by], lazy="select")
    aliases: Mapped[list[PartyAlias]] = relationship(
        "PartyAlias", back_populates="canonical", lazy="select"
    )

    def __repr__(self) -> str:
        # Do NOT include raw name — CLAUDE.md data-handling rule: redact
        # party names in non-debug logs / reprs.
        return f"<PartyCanonical id={self.id} entity={self.entity_id}>"


class PartyAlias(UUIDPrimaryKeyMixin, Base):
    """Raw name → canonical mapping (spec §3 party_aliases).

    Unique per (canonical_id, alias_text) — the same raw text cannot map
    to the same canonical twice.  A raw text CAN map to multiple canonicals
    (rare, but the schema does not forbid it; analyst resolves the conflict).
    """

    __tablename__ = "party_aliases"
    __table_args__ = (
        # Short name: convention → ck_party_aliases_source
        CheckConstraint(
            "source IN ('TALLY', 'XERO', 'MANUAL')",
            name="source",
        ),
        UniqueConstraint("canonical_id", "alias_text", name="uq_party_aliases_canonical_alias"),
        Index("ix_party_aliases_alias_text", "alias_text"),
    )

    canonical_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("parties_canonical.id", ondelete="CASCADE"),
        nullable=False,
    )
    alias_text: Mapped[str] = mapped_column(Text, nullable=False)
    # 'TALLY' | 'XERO' | 'MANUAL' — enforced by CHECK above.
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    # Fuzzy match score 0–100 at creation time; NULL for exact/manual matches.
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    canonical: Mapped[PartyCanonical] = relationship(
        "PartyCanonical", back_populates="aliases", lazy="select"
    )
    confirmer: Mapped[User | None] = relationship(
        "User", foreign_keys=[confirmed_by], lazy="select"
    )
    creator: Mapped[User] = relationship("User", foreign_keys=[created_by], lazy="select")

    def __repr__(self) -> str:
        # Do NOT include alias_text — contains raw party name.
        return f"<PartyAlias id={self.id} canonical={self.canonical_id} source={self.source}>"
