"""Alembic env — pulls DB URL from app settings, registers all models via Base."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Import the models package so every model module is loaded and
# Base.metadata is fully populated. (Empty until Task 3; grows as
# Entity / User / FxRate / AuditLog land.)
import app.db.models  # noqa: F401
from app.config import get_settings
from app.db.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Inject DB URL from env (via pydantic-settings). Prefer the unpooled
# (direct) Neon connection for migrations — pgbouncer transaction pooling
# doesn't support all session-level statements Alembic needs.
_s = get_settings()
config.set_main_option(
    "sqlalchemy.url",
    _s.database_url_direct or _s.database_url,
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
