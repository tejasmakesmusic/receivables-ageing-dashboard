"""Integration-flavoured tests for app.services.partition_check (M3 Task 2).

Marked ``integration`` because they require a live DB session (Neon branch).
They assert against the partitions seeded by migration 0003_m3_ingestion:
  - invoice_snapshots_2026_q1: 2026-01-01 to 2026-04-01
  - invoice_snapshots_2026_q2: 2026-04-01 to 2026-07-01
"""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

import pytest

from app.services.partition_check import invoice_snapshots_has_partition_for

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

pytestmark = pytest.mark.integration


class TestInvoiceSnapshotsHasPartitionFor:
    def test_q1_2026_covered(self, db_session: Session) -> None:
        """2026-01-01 falls in Q1 partition."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 1, 1)) is True

    def test_q1_2026_mid_covered(self, db_session: Session) -> None:
        """2026-02-15 is mid-Q1."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 2, 15)) is True

    def test_q1_2026_last_day_covered(self, db_session: Session) -> None:
        """2026-03-31 is last day of Q1 (TO is exclusive 2026-04-01)."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 3, 31)) is True

    def test_q2_2026_start_covered(self, db_session: Session) -> None:
        """2026-04-01 is the start of Q2 partition."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 4, 1)) is True

    def test_q2_2026_mid_covered(self, db_session: Session) -> None:
        """2026-05-20 is mid-Q2."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 5, 20)) is True

    def test_q2_2026_last_day_covered(self, db_session: Session) -> None:
        """2026-06-30 is last day of Q2 (TO is exclusive 2026-07-01)."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 6, 30)) is True

    def test_q3_2026_not_covered(self, db_session: Session) -> None:
        """2026-07-01 is Q3 — no partition created in migration 0003."""
        assert invoice_snapshots_has_partition_for(db_session, date(2026, 7, 1)) is False

    def test_q4_2025_not_covered(self, db_session: Session) -> None:
        """2025-12-31 predates any created partition."""
        assert invoice_snapshots_has_partition_for(db_session, date(2025, 12, 31)) is False

    def test_2025_q1_not_covered(self, db_session: Session) -> None:
        """2025-03-15 — no partition exists for 2025."""
        assert invoice_snapshots_has_partition_for(db_session, date(2025, 3, 15)) is False
