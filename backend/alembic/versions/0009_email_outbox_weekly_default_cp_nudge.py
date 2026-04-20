"""Extend email_outbox.rule_type CHECK to include WEEKLY_DEFAULT_CP_NUDGE.

The M6 email_outbox table was created with:
    rule_type IN ('DAILY_DIGEST', 'PUBLISH_NOTIF')

This migration widens the constraint to allow the new weekly analyst nudge
(spec §13 #5) for parties currently using entity default credit period.

Revision ID: 0009_email_outbox_weekly_cp_nudge
Revises: 0008_q3_q4_2026_partitions
Create Date: 2026-04-19

Rollback note:
    downgrade() reinstates the two-value constraint.  Any
    WEEKLY_DEFAULT_CP_NUDGE rows already in the outbox must be deleted (or
    their rule_type changed) before downgrading, otherwise the ALTER fails.
    Safe in dev/test; confirm outbox is clean in production before rolling back.
"""

from __future__ import annotations

from alembic import op

revision = "0009_email_outbox_weekly_nudge"
down_revision = "0008_q3_q4_2026_partitions"
branch_labels = None
depends_on = None

_CONSTRAINT_NAME = "ck_email_outbox_rule_type"
_OLD_CHECK = "rule_type IN ('DAILY_DIGEST', 'PUBLISH_NOTIF')"
_NEW_CHECK = "rule_type IN ('DAILY_DIGEST', 'PUBLISH_NOTIF', 'WEEKLY_DEFAULT_CP_NUDGE')"


def upgrade() -> None:
    # PostgreSQL does not support ALTER CONSTRAINT for CHECK constraints;
    # we must drop-and-recreate.
    # The constraint was created in migration 0006 with name 'rule_type', but
    # SQLAlchemy's naming convention prefixed it as 'ck_email_outbox_rule_type'.
    # However the ORM model used a double-prefix via the CheckConstraint(name=...)
    # argument inside __table_args__ which caused the actual DB name to be
    # 'ck_email_outbox_ck_email_outbox_rule_type'.  We use raw SQL here to be
    # explicit and independent of any naming-convention ambiguity.
    op.execute(
        "ALTER TABLE email_outbox "
        "DROP CONSTRAINT IF EXISTS ck_email_outbox_ck_email_outbox_rule_type"
    )
    op.execute(
        "ALTER TABLE email_outbox "
        "DROP CONSTRAINT IF EXISTS ck_email_outbox_rule_type"
    )
    op.execute(
        "ALTER TABLE email_outbox "
        f"ADD CONSTRAINT {_CONSTRAINT_NAME} CHECK ({_NEW_CHECK})"
    )


def downgrade() -> None:
    # Delete any WEEKLY_DEFAULT_CP_NUDGE rows first (safe in dev; production
    # should verify manually before running).
    op.execute(
        "DELETE FROM email_outbox WHERE rule_type = 'WEEKLY_DEFAULT_CP_NUDGE'"
    )
    op.execute(
        f"ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS {_CONSTRAINT_NAME}"
    )
    op.execute(
        "ALTER TABLE email_outbox "
        f"ADD CONSTRAINT {_CONSTRAINT_NAME} CHECK ({_OLD_CHECK})"
    )
