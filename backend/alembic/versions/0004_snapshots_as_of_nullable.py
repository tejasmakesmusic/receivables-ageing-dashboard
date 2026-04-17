"""Make snapshots.as_of_date nullable for CREDIT_PERIOD uploads.

CREDIT_PERIOD is a configuration import — there is no logical "as-of date"
for a credit period master file.  Making the column nullable is cleaner than
using a sentinel like date(1970, 1, 1) and avoids polluting downstream ageing
queries with guard clauses.

Revision ID: 0004_snapshots_as_of_nullable
Revises: 0003_m3_ingestion
Create Date: 2026-04-17

Rollback note:
    downgrade() restores NOT NULL.  Any snapshot rows with as_of_date=NULL
    (i.e. CREDIT_PERIOD uploads) must be deleted FIRST or the ALTER will fail.
    The downgrade step intentionally does NOT delete those rows — the DBA must
    handle data cleanup manually.  See docs/runbook.md for the procedure.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_snapshots_as_of_nullable"
down_revision = "0003_m3_ingestion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "snapshots",
        "as_of_date",
        existing_type=sa.Date(),
        nullable=True,
    )


def downgrade() -> None:
    # WARNING: will fail if any row has as_of_date IS NULL.
    # Delete CREDIT_PERIOD snapshot rows first.
    op.alter_column(
        "snapshots",
        "as_of_date",
        existing_type=sa.Date(),
        nullable=False,
    )
