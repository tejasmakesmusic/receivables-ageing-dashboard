"""Declarative base for all SQLAlchemy models.

Models live under `app.models.*`. Alembic's env.py imports this Base so
autogenerate sees every model registered via subclassing.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base. Add naming convention + type annotations here
    when the first real model lands in Milestone 1."""
