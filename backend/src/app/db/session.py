"""SQLAlchemy engine + session factory. Single source of truth."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.engine import Engine


def _normalize_dsn(dsn: str) -> str:
    """Force the psycopg3 driver.

    Railway Postgres and many hosted providers expose DSNs as `postgresql://`,
    which SQLAlchemy routes to the legacy psycopg2 driver we don't ship. We
    install only psycopg3 (`psycopg[binary]`), so rewrite to the explicit
    `postgresql+psycopg://` scheme. Leave any already-explicit scheme alone.
    """
    if dsn.startswith("postgresql://"):
        return "postgresql+psycopg://" + dsn[len("postgresql://") :]
    if dsn.startswith("postgres://"):  # legacy Heroku-style — same fix
        return "postgresql+psycopg://" + dsn[len("postgres://") :]
    return dsn


def _build_engine() -> Engine:
    settings = get_settings()
    return create_engine(
        _normalize_dsn(settings.database_url),
        pool_pre_ping=True,
        future=True,
    )


engine: Engine = _build_engine()

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Iterator[Session]:
    """FastAPI dependency — yields a session, closes on request end."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
