"""Add reconciliation_entries and follow_ups tables (M4-M6).

reconciliation_entries: tracks AR reconciliation per snapshot (spec §3 + D19).
follow_ups:            follow-up log per invoice/party (spec §3 + S6).

Revision ID: 0007_reconciliation_entries_and_follow_ups
Revises: 0006_exception_tags_email_outbox
Create Date: 2026-04-18

Rollback note:
    downgrade() drops both tables. Any reconciliation entries or follow-up logs
    will be lost. Safe in dev/test; in production confirm no data before downgrading.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0007_reconciliation_follow_ups"
down_revision = "0006_exception_tags_email_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # reconciliation_entries — spec §3 DDL (D19)
    # -----------------------------------------------------------------------
    op.create_table(
        "reconciliation_entries",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "snapshot_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("snapshots.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,  # one reconciliation entry per snapshot
        ),
        sa.Column("dashboard_ar", sa.Numeric(18, 2), nullable=False),
        sa.Column("exception_bucket_total", sa.Numeric(18, 2), nullable=False),
        sa.Column(
            "exception_bucket_breakdown",
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("tally_xero_closing_ar", sa.Numeric(18, 2), nullable=True),
        sa.Column("delta", sa.Numeric(18, 2), nullable=True),
        sa.Column(
            "status",
            sa.Text,
            sa.CheckConstraint(
                "status IN ('MATCHED', 'MISMATCHED', 'UNRECONCILED')",
                name="ck_reconciliation_entries_status",
            ),
            nullable=False,
            server_default=sa.text("'UNRECONCILED'"),
        ),
        sa.Column(
            "entered_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("entered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
    )
    op.create_index(
        "ix_reconciliation_entries_snapshot_id",
        "reconciliation_entries",
        ["snapshot_id"],
    )

    # -----------------------------------------------------------------------
    # follow_ups — spec §3 DDL (S6 stub)
    # -----------------------------------------------------------------------
    op.create_table(
        "follow_ups",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "invoice_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("invoices.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "canonical_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("parties_canonical.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "date",
            sa.Date,
            nullable=False,
        ),
        sa.Column(
            "channel",
            sa.Text,
            sa.CheckConstraint(
                "channel IN ('EMAIL', 'CALL', 'WHATSAPP', 'MEETING')",
                name="ck_follow_ups_channel",
            ),
            nullable=False,
        ),
        sa.Column("contact_person", sa.Text, nullable=True),
        sa.Column("next_action_date", sa.Date, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "logged_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "logged_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_follow_ups_canonical_id", "follow_ups", ["canonical_id"])
    op.create_index("ix_follow_ups_invoice_id", "follow_ups", ["invoice_id"])


def downgrade() -> None:
    op.drop_index("ix_follow_ups_invoice_id", table_name="follow_ups")
    op.drop_index("ix_follow_ups_canonical_id", table_name="follow_ups")
    op.drop_table("follow_ups")
    op.drop_index(
        "ix_reconciliation_entries_snapshot_id", table_name="reconciliation_entries"
    )
    op.drop_table("reconciliation_entries")
