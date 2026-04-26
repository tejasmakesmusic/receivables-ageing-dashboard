"""Integration tests for GET /snapshots — reconciliation field on SnapshotListRow.

Task 11 (A6 historical reconciliations): asserts that the reconciliation nested
field is correctly populated (or absent) for each snapshot status.

Seeds 3 snapshots:
  1. MATCHED   — a ReconciliationEntry with status=MATCHED exists
  2. MISMATCHED — a ReconciliationEntry with status=MISMATCHED exists
  3. No entry   — reconciliation field must be None
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.db.models.entity import Entity
from app.db.models.reconciliation_entry import ReconciliationEntry
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return cast(uuid.UUID, u.id)


def _entity_id(db_session: Session, code: str = "IND") -> uuid.UUID:
    e = db_session.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return cast(uuid.UUID, e.id)


def _make_published_snapshot(
    db_session: Session,
    as_of_date: date,
    tag: str = "",
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, "IND")
    snap = Snapshot(
        entity_id=entity_id,
        as_of_date=as_of_date,
        status="PUBLISHED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex + tag,
        uploaded_by=admin,
    )
    db_session.add(snap)
    db_session.flush()
    return cast(uuid.UUID, snap.id)


def _add_reconciliation_entry(
    db_session: Session,
    snapshot_id: uuid.UUID,
    status: str,
    dashboard_ar: Decimal = Decimal("10000"),
    tally_ar: Decimal | None = None,
    delta: Decimal | None = None,
) -> None:
    admin = _admin_id(db_session)
    entry = ReconciliationEntry(
        snapshot_id=snapshot_id,
        dashboard_ar=dashboard_ar,
        exception_bucket_total=Decimal("0"),
        exception_bucket_breakdown={},
        tally_xero_closing_ar=tally_ar,
        delta=delta,
        status=status,
        entered_by=admin,
        entered_at=datetime(2026, 4, 1, 10, 0, 0, tzinfo=UTC),
    )
    db_session.add(entry)
    db_session.flush()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_list_snapshots_reconciliation_field_shape(client: TestClient, db_session: Session) -> None:
    """Three snapshots — MATCHED, MISMATCHED, no entry — reconciliation field correct."""
    _login_as_admin(client)

    # 1. Snapshot with MATCHED reconciliation
    snap_matched = _make_published_snapshot(db_session, date(2026, 1, 31), tag="m")
    _add_reconciliation_entry(
        db_session,
        snap_matched,
        status="MATCHED",
        dashboard_ar=Decimal("10000"),
        tally_ar=Decimal("10000"),
        delta=Decimal("0"),
    )

    # 2. Snapshot with MISMATCHED reconciliation
    snap_mismatched = _make_published_snapshot(db_session, date(2026, 2, 28), tag="mm")
    _add_reconciliation_entry(
        db_session,
        snap_mismatched,
        status="MISMATCHED",
        dashboard_ar=Decimal("10000"),
        tally_ar=Decimal("9000"),
        delta=Decimal("1000"),
    )

    # 3. Snapshot with NO reconciliation entry
    snap_none = _make_published_snapshot(db_session, date(2026, 3, 31), tag="n")

    resp = client.get("/snapshots?entity_code=IND&status=PUBLISHED&page_size=50")
    assert resp.status_code == 200, resp.json()
    items = resp.json()["items"]

    by_id = {i["id"]: i for i in items}

    # --- MATCHED snapshot ---
    assert str(snap_matched) in by_id, "MATCHED snapshot missing from list"
    row_m = by_id[str(snap_matched)]
    assert "reconciliation" in row_m
    recon_m = row_m["reconciliation"]
    assert recon_m is not None
    assert recon_m["status"] == "MATCHED"
    assert Decimal(recon_m["delta"]) == Decimal("0")
    assert Decimal(recon_m["tally_xero_closing_ar"]) == Decimal("10000")
    assert Decimal(recon_m["dashboard_ar"]) == Decimal("10000")
    assert recon_m["updated_at"] is not None

    # --- MISMATCHED snapshot ---
    assert str(snap_mismatched) in by_id, "MISMATCHED snapshot missing from list"
    row_mm = by_id[str(snap_mismatched)]
    assert "reconciliation" in row_mm
    recon_mm = row_mm["reconciliation"]
    assert recon_mm is not None
    assert recon_mm["status"] == "MISMATCHED"
    assert Decimal(recon_mm["delta"]) == Decimal("1000")
    assert Decimal(recon_mm["tally_xero_closing_ar"]) == Decimal("9000")

    # --- Snapshot with NO entry ---
    assert str(snap_none) in by_id, "No-entry snapshot missing from list"
    row_n = by_id[str(snap_none)]
    assert "reconciliation" in row_n
    assert row_n["reconciliation"] is None


def test_list_snapshots_existing_tests_not_broken(client: TestClient, db_session: Session) -> None:
    """Basic sanity: list still returns expected top-level fields after schema change."""
    _login_as_admin(client)
    _make_published_snapshot(db_session, date(2026, 4, 15), tag="basic")

    resp = client.get("/snapshots?page=1&page_size=5")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert "page" in body
    assert "page_size" in body
    row = body["items"][0]
    for field in ("id", "entity_code", "as_of_date", "status", "source_hint", "reconciliation"):
        assert field in row, f"Missing field: {field}"
