"""M3 ingestion schema — snapshots, parties, credit_period_config,
invoices, invoice_snapshots (partitioned), exception_bucket_types + D9 seed.

Revision ID: 0003_m3_ingestion
Revises: 0002_seed_bootstrap_admin
Create Date: 2026-04-17

Partition naming convention for invoice_snapshots:
    invoice_snapshots_<YYYY>_q<N>
    where N = 1 (Jan-Mar), 2 (Apr-Jun), 3 (Jul-Sep), 4 (Oct-Dec)

    Examples:
        invoice_snapshots_2026_q1  FOR VALUES FROM ('2026-01-01') TO ('2026-04-01')
        invoice_snapshots_2026_q2  FOR VALUES FROM ('2026-04-01') TO ('2026-07-01')

    Two partitions covering 2026-Q1 and 2026-Q2 are seeded here so that
    tests can insert rows with as_of_date in 2026.

    Downstream: M6 cron or a DBA must CREATE new partitions before uploads
    arrive with as_of_date values falling into a new quarter.  See
    docs/runbook.md §"Partitioning invoice_snapshots" for the DDL template.

Rollback note:
    downgrade() drops every object created here in reverse dependency order.
    D9 seed rows are also removed.  Safe only when no M3+ data exists.
    Any exception_tags, follow_ups, reconciliation_entries that reference
    these tables must be deleted FIRST before downgrading past this migration.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "0003_m3_ingestion"
down_revision = "0002_seed_bootstrap_admin"
branch_labels = None
depends_on = None

# ---------------------------------------------------------------------------
# D9 seed — exception_bucket_types.  UUIDs are deterministic for rollback.
# ---------------------------------------------------------------------------
_D9_SEEDS = [
    {
        "id": "a1000000-0000-0000-0000-000000000001",
        "code": "LEGAL",
        "name": "Legal / Litigation",
        "description": "Matter under legal/litigation hold",
        "active": True,
    },
    {
        "id": "a1000000-0000-0000-0000-000000000002",
        "code": "DISPUTED",
        "name": "Disputed by client",
        "description": "Client disputes invoice amount or validity",
        "active": True,
    },
    {
        "id": "a1000000-0000-0000-0000-000000000003",
        "code": "CN_PENDING",
        "name": "Credit note pending",
        "description": "Credit note being issued against this invoice",
        "active": True,
    },
    {
        "id": "a1000000-0000-0000-0000-000000000004",
        "code": "WRITTEN_OFF",
        "name": "Written-off",
        "description": (
            "Dashboard-only write-off; must reconcile against Tally/Xero (D16)"
        ),
        "active": True,
    },
]


def upgrade() -> None:
    # ---------------------------------------------------------------------- #
    # snapshots                                                               #
    # Depends on: entities, users                                             #
    # ---------------------------------------------------------------------- #
    op.create_table(
        "snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "entity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("entities.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "uploaded_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("upload_file_path", sa.Text, nullable=True),
        sa.Column("upload_file_sha256", sa.String(64), nullable=False),
        sa.Column("as_of_date", sa.Date, nullable=False),
        sa.Column("source_hint", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="STAGED"),
        sa.Column("row_count", sa.Integer, nullable=True),
        sa.Column("total_outstanding", sa.Numeric(18, 2), nullable=True),
        sa.Column("parse_result_json", postgresql.JSONB, nullable=True),
        sa.Column(
            "warnings_acknowledged_json",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("published_as", sa.String(16), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "published_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("discarded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "discarded_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
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
        # Short names — naming convention adds "ck_snapshots_" prefix:
        #   "source_hint"  → ck_snapshots_source_hint
        #   "status"       → ck_snapshots_status
        #   "published_as" → ck_snapshots_published_as
        sa.CheckConstraint(
            "source_hint IN ('TALLY', 'XERO', 'CREDIT_PERIOD')",
            name="source_hint",
        ),
        sa.CheckConstraint(
            "status IN ('STAGED', 'PUBLISHED', 'DISCARDED')",
            name="status",
        ),
        sa.CheckConstraint(
            "published_as IS NULL OR published_as IN ('NORMAL', 'OVERRIDE')",
            name="published_as",
        ),
        sa.UniqueConstraint("upload_file_sha256", name="uq_snapshots_upload_file_sha256"),
    )
    op.create_index(
        "ix_snapshots_entity_status",
        "snapshots",
        ["entity_id", "status"],
    )

    # ---------------------------------------------------------------------- #
    # parties_canonical                                                        #
    # Depends on: entities, users                                              #
    # ---------------------------------------------------------------------- #
    op.create_table(
        "parties_canonical",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "entity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("entities.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "entity_id", "name", name="uq_parties_canonical_entity_name"
        ),
    )
    op.create_index(
        "ix_parties_canonical_entity_id",
        "parties_canonical",
        ["entity_id"],
    )

    # ---------------------------------------------------------------------- #
    # party_aliases                                                            #
    # Depends on: parties_canonical, users                                    #
    # ---------------------------------------------------------------------- #
    op.create_table(
        "party_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "canonical_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("parties_canonical.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("alias_text", sa.Text, nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("confidence", sa.Numeric(5, 2), nullable=True),
        sa.Column(
            "confirmed_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # Short name: convention → ck_party_aliases_source
        sa.CheckConstraint(
            "source IN ('TALLY', 'XERO', 'MANUAL')",
            name="source",
        ),
        sa.UniqueConstraint(
            "alias_text", "canonical_id", name="uq_party_aliases_alias_canonical"
        ),
    )
    op.create_index(
        "ix_party_aliases_alias_text",
        "party_aliases",
        ["alias_text"],
    )

    # ---------------------------------------------------------------------- #
    # credit_period_config                                                    #
    # Depends on: parties_canonical, users                                    #
    # ---------------------------------------------------------------------- #
    op.create_table(
        "credit_period_config",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "canonical_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("parties_canonical.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("days", sa.Integer, nullable=False),
        sa.Column("reason_note", sa.Text, nullable=True),
        sa.Column("valid_from", sa.Date, nullable=False),
        sa.Column("valid_to", sa.Date, nullable=True),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        # Short name: convention → ck_credit_period_config_days_non_negative
        sa.CheckConstraint(
            "days >= 0",
            name="days_non_negative",
        ),
    )
    # Partial unique: at most one open row per canonical_id (valid_to IS NULL).
    # Must be a CREATE INDEX … WHERE — not expressible as UniqueConstraint.
    op.create_index(
        "ix_credit_period_config_open",
        "credit_period_config",
        ["canonical_id"],
        unique=True,
        postgresql_where=sa.text("valid_to IS NULL"),
    )
    # Latest-lookup index — used by credit_days_source = CONFIG lookups.
    op.create_index(
        "ix_credit_period_config_canonical_valid_from",
        "credit_period_config",
        ["canonical_id", "valid_from"],
    )

    # ---------------------------------------------------------------------- #
    # invoices                                                                #
    # Depends on: entities, parties_canonical, snapshots                     #
    # ---------------------------------------------------------------------- #
    op.create_table(
        "invoices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "entity_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("entities.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "canonical_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("parties_canonical.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("invoice_ref", sa.Text, nullable=False),
        sa.Column("invoice_date", sa.Date, nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("credit_days_applied", sa.Integer, nullable=False),
        sa.Column("credit_days_source", sa.String(16), nullable=False),
        sa.Column("due_date", sa.Date, nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="OPEN"),
        sa.Column(
            "first_seen_snapshot_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("snapshots.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "settled_snapshot_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("snapshots.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("raw_row_json", postgresql.JSONB, nullable=False),
        sa.Column("xero_metadata", postgresql.JSONB, nullable=True),
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
        # Short names — convention adds "ck_invoices_" prefix:
        #   "currency"           → ck_invoices_currency
        #   "credit_days_source" → ck_invoices_credit_days_source
        #   "status"             → ck_invoices_status
        sa.CheckConstraint(
            "currency IN ('INR', 'AED')",
            name="currency",
        ),
        sa.CheckConstraint(
            "credit_days_source IN ('CONFIG', 'DEFAULT', 'MANUAL')",
            name="credit_days_source",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN', 'SETTLED')",
            name="status",
        ),
        sa.UniqueConstraint(
            "entity_id",
            "canonical_id",
            "invoice_ref",
            name="uq_invoices_entity_canonical_ref",
        ),
    )
    op.create_index("ix_invoices_entity_id", "invoices", ["entity_id"])
    # Spec §3 partial index for OPEN invoices (hot path for dashboard queries).
    op.create_index(
        "ix_invoices_status_open",
        "invoices",
        ["status"],
        postgresql_where=sa.text("status = 'OPEN'"),
    )

    # ---------------------------------------------------------------------- #
    # invoice_snapshots — PARTITIONED BY RANGE (as_of_date)                  #
    # Depends on: snapshots, invoices                                         #
    #                                                                         #
    # Postgres requires the partition key to be part of the PK on the parent  #
    # table.  We use PK (id, as_of_date) so ``id`` remains the surrogate      #
    # for JOINs and ``as_of_date`` enables partition pruning.                 #
    # ---------------------------------------------------------------------- #
    op.execute(
        """
        CREATE TABLE invoice_snapshots (
            id              BIGSERIAL,
            snapshot_id     UUID        NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
            invoice_id      UUID        NOT NULL REFERENCES invoices(id)  ON DELETE RESTRICT,
            as_of_date      DATE        NOT NULL,
            outstanding_amount NUMERIC(18, 2) NOT NULL,
            overdue_days    INT         NOT NULL,
            bucket          TEXT        NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_invoice_snapshots_bucket
                CHECK (bucket IN ('NOT_DUE', '0_30', '31_60', '61_90', '90_PLUS')),
            PRIMARY KEY (id, as_of_date)
        )
        PARTITION BY RANGE (as_of_date)
        """
    )
    # Partition-level indexes — must be created on each partition or on the
    # parent (Postgres 11+ propagates CREATE INDEX on partitioned tables).
    op.create_index(
        "ix_invoice_snapshots_snapshot_id",
        "invoice_snapshots",
        ["snapshot_id"],
    )
    op.create_index(
        "ix_invoice_snapshots_as_of_date_bucket",
        "invoice_snapshots",
        ["as_of_date", "bucket"],
    )

    # Seed two quarters so CI/tests can insert rows immediately.
    # Q1 2026: 2026-01-01 .. 2026-03-31 (upper bound exclusive → 2026-04-01)
    op.execute(
        """
        CREATE TABLE invoice_snapshots_2026_q1
            PARTITION OF invoice_snapshots
            FOR VALUES FROM ('2026-01-01') TO ('2026-04-01')
        """
    )
    # Q2 2026: 2026-04-01 .. 2026-06-30 (upper bound exclusive → 2026-07-01)
    op.execute(
        """
        CREATE TABLE invoice_snapshots_2026_q2
            PARTITION OF invoice_snapshots
            FOR VALUES FROM ('2026-04-01') TO ('2026-07-01')
        """
    )

    # ---------------------------------------------------------------------- #
    # exception_bucket_types + D9 seed                                       #
    # No FKs to other new tables — safe to create after invoices.            #
    # ---------------------------------------------------------------------- #
    op.create_table(
        "exception_bucket_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("code", sa.String(64), unique=True, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # D9 seed — 4 required exception bucket types.
    # Dollar-quoting ($json$…$json$) avoids single-quote escaping in JSONB
    # (same pattern as 0002_seed_bootstrap_admin).
    for row in _D9_SEEDS:
        description_sql = (
            f"$json${row['description']}$json$"
            if row["description"] is not None
            else "NULL"
        )
        active_sql = "TRUE" if row["active"] else "FALSE"
        op.execute(
            f"""
            INSERT INTO exception_bucket_types (id, code, name, description, active, created_at)
            VALUES (
                '{row["id"]}'::uuid,
                '{row["code"]}',
                '{row["name"]}',
                {description_sql},
                {active_sql},
                NOW()
            )
            """
        )


def downgrade() -> None:
    # Remove in reverse dependency order.

    # D9 seed rows
    for row in reversed(_D9_SEEDS):
        op.execute(
            f"DELETE FROM exception_bucket_types WHERE id = '{row['id']}'::uuid"
        )
    op.drop_table("exception_bucket_types")

    # invoice_snapshots: drop partition children first, then parent.
    # DROP TABLE on partitions cascades index drops.
    op.execute("DROP TABLE IF EXISTS invoice_snapshots_2026_q2")
    op.execute("DROP TABLE IF EXISTS invoice_snapshots_2026_q1")
    op.drop_index("ix_invoice_snapshots_as_of_date_bucket", table_name="invoice_snapshots")
    op.drop_index("ix_invoice_snapshots_snapshot_id", table_name="invoice_snapshots")
    op.execute("DROP TABLE IF EXISTS invoice_snapshots")

    # invoices
    op.drop_index("ix_invoices_status_open", table_name="invoices")
    op.drop_index("ix_invoices_entity_id", table_name="invoices")
    op.drop_table("invoices")

    # credit_period_config
    op.drop_index(
        "ix_credit_period_config_canonical_valid_from",
        table_name="credit_period_config",
    )
    op.drop_index(
        "ix_credit_period_config_open",
        table_name="credit_period_config",
    )
    op.drop_table("credit_period_config")

    # party_aliases
    op.drop_index("ix_party_aliases_alias_text", table_name="party_aliases")
    op.drop_table("party_aliases")

    # parties_canonical
    op.drop_index("ix_parties_canonical_entity_id", table_name="parties_canonical")
    op.drop_table("parties_canonical")

    # snapshots
    op.drop_index("ix_snapshots_entity_status", table_name="snapshots")
    op.drop_table("snapshots")
