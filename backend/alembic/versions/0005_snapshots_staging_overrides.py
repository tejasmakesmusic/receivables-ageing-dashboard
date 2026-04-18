"""Add staging_overrides_json column to snapshots for analyst review actions.

Each analyst action (resolve_alias, override_credit_days, dismiss_parse_error,
etc.) appends an entry to this column rather than rewriting parse_result_json.
Latest-wins semantics: for a given row_index, the last entry in the list is
the effective override.  This keeps the original parser output immutable and
provides a full history of analyst actions.

Revision ID: 0005_snapshots_staging_overrides
Revises: 0004_snapshots_as_of_nullable
Create Date: 2026-04-17

Rollback note:
    downgrade() drops the column.  Any analyst override data will be lost.
    The column is safe to drop without data migration because it is
    supplementary to parse_result_json (the primary record).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005_snapshots_staging_overrides"
down_revision = "0004_snapshots_as_of_nullable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "snapshots",
        sa.Column(
            "staging_overrides_json",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("snapshots", "staging_overrides_json")
