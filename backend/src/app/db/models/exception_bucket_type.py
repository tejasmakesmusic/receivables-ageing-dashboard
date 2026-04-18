"""ExceptionBucketType — pre-seeded classification codes for exception tags (spec §3 + D9).

The four seed rows required by D9 are inserted by Alembic migration
``0003_m3_ingestion`` (not a separate data migration).  Admins can add
further codes via the ``/admin/exception-buckets`` screen (A3).

``active = False`` soft-deletes a bucket type — tagged invoices retain their
tag, but new tagging is blocked on inactive types.

``code`` is immutable by convention: changing a code would orphan existing
exception_tags rows that reference the old code name in audit_log entries.
Any rename should add a new code + migrate data, then deactivate the old one.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func, true
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base, UUIDPrimaryKeyMixin


class ExceptionBucketType(UUIDPrimaryKeyMixin, Base):
    """Classification code for an exception tag on an invoice (spec §3 + D9)."""

    __tablename__ = "exception_bucket_types"

    # e.g. 'LEGAL', 'DISPUTED', 'CN_PENDING', 'WRITTEN_OFF'
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=true(),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return f"<ExceptionBucketType code={self.code} active={self.active}>"
