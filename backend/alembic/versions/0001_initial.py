"""M1 initial schema — entities, users, fx_rates, audit_log.

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-16

Rollback note: downgrade() drops all four tables, both native enum types,
the D15 trigger + function on fx_rates, and the partial unique index.
No data loss risk — this is the very first migration (down_revision=None).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

# Native Postgres enum types for this migration.
# Using postgresql.ENUM(..., create_type=False) in op.create_table columns so
# SQLAlchemy does NOT fire _on_table_create (which would try to CREATE TYPE
# again and fail). We emit CREATE TYPE explicitly via op.execute before the
# table DDL so we control IF NOT EXISTS behaviour cleanly.
_ROLE_ENUM_NAME = "role_enum"
_FX_SOURCE_ENUM_NAME = "fx_rate_source"


def upgrade() -> None:
    # ------------------------------------------------------------------ #
    # entities                                                             #
    # ------------------------------------------------------------------ #
    op.create_table(
        "entities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("default_credit_days", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("code", name="uq_entities_code"),
    )

    # ------------------------------------------------------------------ #
    # users (depends on entities)                                          #
    # ------------------------------------------------------------------ #
    # Emit CREATE TYPE before the table. create_type=False on ENUM suppresses
    # SQLAlchemy's _on_table_create hook so there is no double-create attempt
    # inside the same Alembic transaction.
    op.execute(f"CREATE TYPE {_ROLE_ENUM_NAME} AS ENUM ('ANALYST', 'CFO', 'ADMIN', 'PENDING')")

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("google_sub", sa.String(64), nullable=True),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column(
            "role",
            postgresql.ENUM(
                "ANALYST",
                "CFO",
                "ADMIN",
                "PENDING",
                name=_ROLE_ENUM_NAME,
                create_type=False,
            ),
            nullable=False,
            server_default="PENDING",
        ),
        sa.Column(
            "entity_id_scope",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("google_sub", name="uq_users_google_sub"),
    )

    # ------------------------------------------------------------------ #
    # fx_rates (depends on users via created_by)                          #
    # ------------------------------------------------------------------ #
    op.execute(f"CREATE TYPE {_FX_SOURCE_ENUM_NAME} AS ENUM ('MANUAL', 'API')")

    op.create_table(
        "fx_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("from_ccy", sa.String(3), nullable=False),
        sa.Column("to_ccy", sa.String(3), nullable=False),
        sa.Column("rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("effective_from", sa.Date, nullable=False),
        sa.Column("effective_to", sa.Date, nullable=True),
        sa.Column(
            "source",
            postgresql.ENUM(
                "MANUAL",
                "API",
                name=_FX_SOURCE_ENUM_NAME,
                create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("from_ccy", "to_ccy", "effective_from", name="uq_fx_rate_triple"),
    )

    # D15 support: only one currently-effective rate per (from_ccy, to_ccy).
    # A second row with effective_to=NULL would mean two "live" rates for the
    # same pair — logically impossible. Postgres partial unique index is the
    # cleanest enforcement (SQLAlchemy's UniqueConstraint can't express this).
    op.create_index(
        "uq_fx_rates_pair_open",
        "fx_rates",
        ["from_ccy", "to_ccy"],
        unique=True,
        postgresql_where=sa.text("effective_to IS NULL"),
    )

    # D15 backstop: block UPDATEs at the DB level. The ORM before_flush hook
    # catches session-level mutations but not session.execute(update(...)) bulk
    # paths. This trigger covers the bypass route so fx_rates is genuinely
    # append-only regardless of how it is accessed.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fx_rates_block_update()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION
                'fx_rates is immutable (D15); insert a new row with a new effective_from instead (id=%)',
                OLD.id
            USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER fx_rates_no_update
        BEFORE UPDATE ON fx_rates
        FOR EACH ROW EXECUTE FUNCTION fx_rates_block_update();
        """
    )

    # ------------------------------------------------------------------ #
    # audit_log (depends on users via actor_user_id)                      #
    # ------------------------------------------------------------------ #
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("before", postgresql.JSONB, nullable=True),
        sa.Column("after", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])


def downgrade() -> None:
    # Tear down in reverse dependency order.

    # audit_log
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_table("audit_log")

    # fx_rates — drop D15 trigger + function + partial index before table
    op.execute("DROP TRIGGER IF EXISTS fx_rates_no_update ON fx_rates;")
    op.execute("DROP FUNCTION IF EXISTS fx_rates_block_update();")
    op.drop_index("uq_fx_rates_pair_open", table_name="fx_rates")
    op.drop_table("fx_rates")
    op.execute(f"DROP TYPE IF EXISTS {_FX_SOURCE_ENUM_NAME};")

    # users
    op.drop_table("users")
    op.execute(f"DROP TYPE IF EXISTS {_ROLE_ENUM_NAME};")

    # entities
    op.drop_table("entities")
