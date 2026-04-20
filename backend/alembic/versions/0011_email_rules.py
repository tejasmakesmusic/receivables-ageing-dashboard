"""Add email_rules table with 3 seeded rows (Task A.3).

email_rules stores per-rule-type recipients, schedule, and active flag so that
ADMIN can edit notification config without code changes.

Revision ID: 0011_email_rules
Revises: 0010_exception_exclude
Create Date: 2026-04-20

Rollback note:
    downgrade() drops the email_rules table entirely.  Any edits made via the
    admin UI are permanently lost.  Safe in dev/test; in production back up the
    table before rolling back.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0011_email_rules"
down_revision = "0010_exception_exclude"
branch_labels = None
depends_on = None

_RULE_TYPE_CHECK = (
    "rule_type IN ('DAILY_DIGEST', 'WEEKLY_DEFAULT_CP_NUDGE', 'PUBLISH_NOTIF')"
)
_ENTITY_FILTER_CHECK = "entity_filter IN ('IND', 'UAE', 'ALL')"


def upgrade() -> None:
    op.create_table(
        "email_rules",
        sa.Column(
            "id",
            pg.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("rule_type", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "recipients_json",
            pg.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("cron_schedule", sa.String(64), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("entity_filter", sa.String(8), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_by",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(_RULE_TYPE_CHECK, name="ck_email_rules_rule_type"),
        sa.CheckConstraint(_ENTITY_FILTER_CHECK, name="ck_email_rules_entity_filter"),
    )

    # Seed 3 canonical rows.
    # DAILY_DIGEST  — inactive by default; cron runs at 09:00 IST daily.
    # WEEKLY_DEFAULT_CP_NUDGE — inactive by default; cron runs Mon 09:00 IST.
    # PUBLISH_NOTIF — active by default (fires on every publish); no cron.
    op.execute(
        """
        INSERT INTO email_rules
            (rule_type, recipients_json, cron_schedule, is_active)
        VALUES
            ('DAILY_DIGEST',              '[]', '0 9 * * *',  false),
            ('WEEKLY_DEFAULT_CP_NUDGE',   '[]', '0 9 * * 1',  false),
            ('PUBLISH_NOTIF',             '[]', NULL,          true)
        """
    )


def downgrade() -> None:
    op.drop_table("email_rules")
