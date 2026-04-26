"""Add Q3 and Q4 2026 partitions on invoice_snapshots.

Revision ID: 0008_q3_q4_2026_partitions
Revises: 0007_reconciliation_follow_ups
Create Date: 2026-04-19

Partition naming convention (see docs/runbook.md § Partitioning invoice_snapshots):
    invoice_snapshots_<YYYY>_q<N>
    where N = 1 (Jan-Mar), 2 (Apr-Jun), 3 (Jul-Sep), 4 (Oct-Dec)

    This migration adds:
        invoice_snapshots_2026_q3  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01')
        invoice_snapshots_2026_q4  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01')

    Q1 and Q2 were seeded in migration 0003_m3_ingestion.

Rollback note:
    downgrade() drops Q4 then Q3 (reverse creation order).  Safe only when no
    invoice_snapshots rows with as_of_date in 2026-Q3 or 2026-Q4 exist.  Confirm
    before downgrading in production.

Next partition deadline:
    2026-12-25 — create 2027-Q1 (FOR VALUES FROM '2027-01-01' TO '2027-04-01')
    using the DDL template in docs/runbook.md.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic
revision = "0008_q3_q4_2026_partitions"
down_revision = "0007_reconciliation_follow_ups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Q3 2026: 2026-07-01 to 2026-09-30 (upper bound exclusive → 2026-10-01)
    op.execute(
        """
        CREATE TABLE invoice_snapshots_2026_q3
            PARTITION OF invoice_snapshots
            FOR VALUES FROM ('2026-07-01') TO ('2026-10-01')
        """
    )
    # Q4 2026: 2026-10-01 to 2026-12-31 (upper bound exclusive → 2027-01-01)
    op.execute(
        """
        CREATE TABLE invoice_snapshots_2026_q4
            PARTITION OF invoice_snapshots
            FOR VALUES FROM ('2026-10-01') TO ('2027-01-01')
        """
    )


def downgrade() -> None:
    # Drop in reverse creation order (Q4 before Q3).
    # DROP TABLE on a partition automatically removes its rows and propagates
    # index drops — no separate index cleanup required.
    op.execute("DROP TABLE IF EXISTS invoice_snapshots_2026_q4")
    op.execute("DROP TABLE IF EXISTS invoice_snapshots_2026_q3")
