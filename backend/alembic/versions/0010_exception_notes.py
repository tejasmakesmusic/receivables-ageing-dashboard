"""Add exception_notes timeline table for exception-tag annotations."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_exception_notes"
down_revision = "0009_email_outbox_weekly_nudge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exception_notes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "exception_tag_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("exception_tags.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column(
            "author_user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_exception_notes_exception_tag_id", "exception_notes", ["exception_tag_id"])


def downgrade() -> None:
    op.drop_index("ix_exception_notes_exception_tag_id", table_name="exception_notes")
    op.drop_table("exception_notes")
