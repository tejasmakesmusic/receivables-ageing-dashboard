"""Model re-exports so `from app.db.models import User` works."""

from __future__ import annotations

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

__all__ = ["Base", "TimestampMixin", "UUIDPrimaryKeyMixin"]
