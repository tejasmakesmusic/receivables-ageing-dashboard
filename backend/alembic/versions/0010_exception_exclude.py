"""Add exclusion columns to exception_tags (Task A.1 — Exception exclude flow).

Adds four nullable columns to exception_tags:
  - excluded_at      TIMESTAMPTZ NULL
  - excluded_reason  VARCHAR(64)  NULL  CHECK(LEGAL_HOLD|NEGOTIATION|AGREED_WRITE_OFF|OTHER)
  - excluded_reason_note TEXT NULL
  - excluded_by      UUID NULL REFERENCES users(id)

Exclusion is orthogonal to status (ACTIVE/RESOLVED/AUTO_RESOLVED); excluded
rows stay in the DB for audit trail but are hidden from S5 default view.

Revision ID: 0010_exception_exclude
Revises: 0009_email_outbox_weekly_nudge
Create Date: 2026-04-20

Rollback note:
    downgrade() drops all four columns. Any excluded_* data is permanently
    lost. Safe in dev/test. In production, verify no UI relies on these
    columns before rolling back.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0010_exception_exclude"
down_revision = "0009_email_outbox_weekly_nudge"
branch_labels = None
depends_on = None

_CONSTRAINT_NAME = "ck_exception_tags_excluded_reason"
_REASON_CHECK = (
    "excluded_reason IN ('LEGAL_HOLD', 'NEGOTIATION', 'AGREED_WRITE_OFF', 'OTHER')"
)


def upgrade() -> None:
    op.add_column(
        "exception_tags",
        sa.Column("excluded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "exception_tags",
        sa.Column("excluded_reason", sa.String(64), nullable=True),
    )
    op.add_column(
        "exception_tags",
        sa.Column("excluded_reason_note", sa.Text(), nullable=True),
    )
    op.add_column(
        "exception_tags",
        sa.Column(
            "excluded_by",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Add CHECK constraint for excluded_reason values
    op.execute(
        f"ALTER TABLE exception_tags ADD CONSTRAINT {_CONSTRAINT_NAME} "
        f"CHECK ({_REASON_CHECK})"
    )


def downgrade() -> None:
    op.execute(
        f"ALTER TABLE exception_tags DROP CONSTRAINT IF EXISTS {_CONSTRAINT_NAME}"
    )
    op.drop_column("exception_tags", "excluded_by")
    op.drop_column("exception_tags", "excluded_reason_note")
    op.drop_column("exception_tags", "excluded_reason")
    op.drop_column("exception_tags", "excluded_at")
