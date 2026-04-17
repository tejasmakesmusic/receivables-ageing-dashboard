"""InvoiceSnapshot — one row per (invoice, snapshot) pair (spec §3).

This table is PARTITIONED BY RANGE (as_of_date) quarterly from day 1
(spec §3 partitioning note + task brief).

Postgres PARTITION BY RANGE requires the partition key to be part of the
PRIMARY KEY on the parent table.  We therefore define the PK as
``(id, as_of_date)`` rather than just ``id``.  The ``id`` column still
functions as a surrogate key for JOIN purposes (invoice_id → invoice),
but callers must always include ``as_of_date`` in partition-pruning
WHERE clauses for performance.

SQLAlchemy note: we cannot use the standard ``UUIDPrimaryKeyMixin``
(single-column PK) on a partitioned table.  PK and columns are declared
inline instead.

Partition naming convention: ``invoice_snapshots_<YYYY>_q<N>``
    e.g. ``invoice_snapshots_2026_q1``  covers  2026-01-01 – 2026-03-31
         ``invoice_snapshots_2026_q2``  covers  2026-04-01 – 2026-06-30
Downstream (cron / M6) must CREATE new partitions before the first
upload with an ``as_of_date`` that falls into the new quarter.  See
``docs/runbook.md`` § "Partitioning invoice_snapshots" for the DDL
template.

``overdue_days`` can be negative — a value of -5 means the invoice is
5 days away from being due (spec §6 "Not Due" bucket).

``bucket`` values match spec §6 exactly:
    NOT_DUE | 0_30 | 31_60 | 61_90 | 90_PLUS
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base


class InvoiceSnapshot(Base):
    """One ageing observation per (invoice, snapshot) pair.

    The table is declared in Alembic as
    ``PARTITION BY RANGE (as_of_date)`` — SQLAlchemy's ORM does not
    model partitioned tables natively; the migration handles the DDL.
    The ORM model covers the column set and relationships used by the
    application layer for queries; the partition parent table is the
    target for all DML.
    """

    __tablename__ = "invoice_snapshots"
    __table_args__ = (
        # Short name: convention → ck_invoice_snapshots_bucket
        CheckConstraint(
            "bucket IN ('NOT_DUE', '0_30', '31_60', '61_90', '90_PLUS')",
            name="bucket",
        ),
        # Partition key must be in the PK — declared with explicit
        # primary_key=True on both columns below.  Alembic migration emits
        # PRIMARY KEY (id, as_of_date) to satisfy Postgres's requirement.
        Index("ix_invoice_snapshots_snapshot_id", "snapshot_id"),
        Index("ix_invoice_snapshots_as_of_date_bucket", "as_of_date", "bucket"),
    )

    # BIGSERIAL surrogate — Postgres sequences work across partitions.
    # The autoincrement here signals SQLAlchemy to use the sequence on INSERT;
    # Alembic migration creates the column as BIGSERIAL in the DDL.
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        nullable=False,
    )
    # as_of_date is the partition key and also part of the composite PK.
    as_of_date: Mapped[date] = mapped_column(Date, primary_key=True, nullable=False)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("snapshots.id", ondelete="RESTRICT"),
        nullable=False,
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("invoices.id", ondelete="RESTRICT"),
        nullable=False,
    )
    outstanding_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    # Can be negative (invoice not yet due).  spec §6.
    overdue_days: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'NOT_DUE' | '0_30' | '31_60' | '61_90' | '90_PLUS' — CHECK above.
    bucket: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<InvoiceSnapshot id={self.id} "
            f"as_of_date={self.as_of_date} "
            f"bucket={self.bucket} "
            f"overdue_days={self.overdue_days}>"
        )
