"""Add exception_tags, email_outbox tables and material_change_flags_json on snapshots.

exception_tags: tracks AR exceptions (ACTIVE, RESOLVED, AUTO_RESOLVED) per invoice.
email_outbox: staging table for outbound emails (PUBLISH_NOTIF, DAILY_DIGEST).
                M6 SMTP cron drains it.
snapshots: adds material_change_flags_json JSONB for >5% amount change flags (§13 #2).

Revision ID: 0006_m3_exception_tags_and_email_outbox
Revises: 0005_snapshots_staging_overrides
Create Date: 2026-04-18

Rollback note:
    downgrade() drops exception_tags, email_outbox, and the snapshots column.
    Any exception tag data or queued emails will be lost. Safe to drop in
    dev/test; in production run only after verifying the outbox is drained.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0006_exception_tags_email_outbox"
down_revision = "0005_snapshots_staging_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -----------------------------------------------------------------------
    # exception_tags — spec §3 DDL
    # -----------------------------------------------------------------------
    op.create_table(
        "exception_tags",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "invoice_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("invoices.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "bucket_type_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("exception_bucket_types.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column(
            "tagged_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "tagged_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expected_resolution_date", sa.Date, nullable=True),
        sa.Column(
            "status",
            sa.Text,
            sa.CheckConstraint(
                "status IN ('ACTIVE', 'RESOLVED', 'AUTO_RESOLVED')",
                name="ck_exception_tags_status",
            ),
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolution_note", sa.Text, nullable=True),
    )
    # spec §3: index (invoice_id, status)
    op.create_index("ix_exception_tags_invoice_status", "exception_tags", ["invoice_id", "status"])

    # -----------------------------------------------------------------------
    # email_outbox — M6 SMTP drain target
    # -----------------------------------------------------------------------
    op.create_table(
        "email_outbox",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "rule_type",
            sa.Text,
            sa.CheckConstraint(
                "rule_type IN ('DAILY_DIGEST', 'PUBLISH_NOTIF')",
                name="ck_email_outbox_rule_type",
            ),
            nullable=False,
        ),
        sa.Column(
            "snapshot_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("snapshots.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recipients_json",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("subject", sa.Text, nullable=False),
        sa.Column("body_html", sa.Text, nullable=False),
        sa.Column(
            "status",
            sa.Text,
            sa.CheckConstraint(
                "status IN ('QUEUED', 'SENT', 'FAILED')",
                name="ck_email_outbox_status",
            ),
            nullable=False,
            server_default="QUEUED",
        ),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column(
            "enqueued_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    # index for drain cron: status + enqueued_at
    op.create_index("ix_email_outbox_status_enqueued", "email_outbox", ["status", "enqueued_at"])

    # -----------------------------------------------------------------------
    # snapshots.material_change_flags_json — §13 #2 material change flag store
    # -----------------------------------------------------------------------
    op.add_column(
        "snapshots",
        sa.Column(
            "material_change_flags_json",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("snapshots", "material_change_flags_json")
    op.drop_index("ix_email_outbox_status_enqueued", table_name="email_outbox")
    op.drop_table("email_outbox")
    op.drop_index("ix_exception_tags_invoice_status", table_name="exception_tags")
    op.drop_table("exception_tags")
