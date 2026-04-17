"""Declarative Base + shared mixins for all SQLAlchemy models.

Every model must inherit from Base. Most models also pick up
UUIDPrimaryKeyMixin and TimestampMixin for uniformity.

Base sets a Postgres-safe naming convention on its metadata so that
Alembic generates deterministic names for indexes, unique constraints,
check constraints, foreign keys, and primary keys. Without this, names
can drift between `alembic revision --autogenerate` runs and make
downgrades or diffs noisy.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Deterministic constraint names — keep in sync with Alembic's default
# conventions. See: https://alembic.sqlalchemy.org/en/latest/naming.html
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base — all models subclass this."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )


class TimestampMixin:
    # Both timestamps are DB-emitted (`func.now()`) to keep behaviour
    # consistent across ORM, bulk `INSERT ... ON CONFLICT`, raw psycopg,
    # and any future ETL admin scripts. An ORM-side `lambda` onupdate
    # would silently no-op on the non-ORM paths this project uses for
    # ingestion upsert, leaving `updated_at` stale.
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
