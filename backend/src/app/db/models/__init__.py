"""Model re-exports so `from app.db.models import Entity` works.

Each concrete model (Entity, User, FxRate, AuditLog) is added here as it
lands. Importing this package triggers all model modules to load, which
populates `Base.metadata` for Alembic autogenerate.
"""

from __future__ import annotations

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.entity import Entity
from app.db.models.fx_rate import FxRate, FxRateSource
from app.db.models.user import User

__all__ = [
    "Base",
    "Entity",
    "FxRate",
    "FxRateSource",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
]
