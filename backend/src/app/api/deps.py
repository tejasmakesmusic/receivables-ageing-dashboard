"""Shared FastAPI dependencies — DB session, current user, RBAC gates.

Kept minimal in the scaffold. Milestone 1 will wire `get_current_user`
against Google SSO + the `users` table, and `require_role(...)` decorators
against spec §2 D5.
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.session import get_db


def db_session() -> Iterator[Session]:
    """Re-export of `get_db` at the API boundary."""
    yield from get_db()


# Placeholder — implemented in Milestone 1 after users table + SSO land.
# def get_current_user(...): ...
# def require_role(*roles): ...

__all__ = ["db_session", "Depends"]
