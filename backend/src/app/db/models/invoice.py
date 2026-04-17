"""Invoice — one row per unique (entity_id, canonical_id, invoice_ref) (spec §3).

Invoices are **upserted**, not appended.  The same invoice reference can
appear in multiple upload snapshots; each upload either:
  - creates a new invoice row (``first_seen_snapshot_id = current snapshot``)
  - updates ``status``, ``raw_row_json``, ``xero_metadata`` on an existing row
  - marks it ``SETTLED`` by setting ``settled_snapshot_id`` when it is absent
    from a new upload of the same entity (spec §5 publish guard).

``credit_days_source`` records where the applied credit period came from:
    'CONFIG'  — looked up from credit_period_config
    'DEFAULT' — fell back to entity.default_credit_days
    'MANUAL'  — analyst overrode it during staging review (§4 step 4)

``xero_metadata`` holds UAE-specific Xero columns that don't generalise
across entities: ``invoice_seen``, ``invoice_sent``, ``project_id``,
``service_month``, ``primary_person``, ``email`` (spec §4.2 rule 6).
NULL for India/Tally invoices.

``raw_row_json`` stores the exact source row as parsed from Tally/Xero.
It is NEVER printed in logs (CLAUDE.md data-handling rule).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
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

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.entity import Entity
    from app.db.models.party import PartyCanonical
    from app.db.models.snapshot import Snapshot


class Invoice(UUIDPrimaryKeyMixin, Base):
    """An accounts-receivable invoice (spec §3 invoices table)."""

    __tablename__ = "invoices"
    __table_args__ = (
        # Short names — naming convention prefixes "ck_invoices_" automatically:
        #   "currency"           → ck_invoices_currency
        #   "credit_days_source" → ck_invoices_credit_days_source
        #   "status"             → ck_invoices_status
        CheckConstraint(
            "currency IN ('INR', 'AED')",
            name="currency",
        ),
        CheckConstraint(
            "credit_days_source IN ('CONFIG', 'DEFAULT', 'MANUAL')",
            name="credit_days_source",
        ),
        CheckConstraint(
            "status IN ('OPEN', 'SETTLED')",
            name="status",
        ),
        UniqueConstraint(
            "entity_id",
            "canonical_id",
            "invoice_ref",
            name="uq_invoices_entity_canonical_ref",
        ),
        # Plain index on entity_id.
        Index("ix_invoices_entity_id", "entity_id"),
        # Spec §3 partial index for OPEN invoices (hot path for dashboard queries).
        # Needs postgresql_where — listed in __table_args__ for ORM metadata
        # visibility; migration emits the same DDL.
        Index(
            "ix_invoices_status_open",
            "status",
            postgresql_where=sa.text("status = 'OPEN'"),
        ),
    )

    entity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="RESTRICT"),
        nullable=False,
    )
    canonical_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("parties_canonical.id", ondelete="RESTRICT"),
        nullable=False,
    )
    invoice_ref: Mapped[str] = mapped_column(Text, nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    # 'INR' | 'AED' — enforced by CHECK above.
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    credit_days_applied: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'CONFIG' | 'DEFAULT' | 'MANUAL' — enforced by CHECK above.
    credit_days_source: Mapped[str] = mapped_column(String(16), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    # 'OPEN' | 'SETTLED' — enforced by CHECK above.
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="OPEN")
    first_seen_snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("snapshots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    settled_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("snapshots.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Exact source row from Tally/Xero.  Never log raw content (CLAUDE.md).
    raw_row_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # UAE-specific Xero columns — NULL for India/Tally invoices (spec §4.2 rule 6).
    xero_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    entity: Mapped[Entity] = relationship("Entity", lazy="select")
    canonical: Mapped[PartyCanonical] = relationship(
        "PartyCanonical", foreign_keys=[canonical_id], lazy="select"
    )
    first_seen_snapshot: Mapped[Snapshot] = relationship(
        "Snapshot", foreign_keys=[first_seen_snapshot_id], lazy="select"
    )
    settled_snapshot: Mapped[Snapshot | None] = relationship(
        "Snapshot", foreign_keys=[settled_snapshot_id], lazy="select"
    )

    def __repr__(self) -> str:
        # Do NOT expose invoice_ref or raw_row_json — CLAUDE.md data-handling rule.
        return (
            f"<Invoice id={self.id} entity={self.entity_id} "
            f"status={self.status} currency={self.currency}>"
        )
