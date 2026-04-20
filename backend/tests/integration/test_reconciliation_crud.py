"""Integration tests for GET/POST /snapshots/:id/reconciliation (M6 Group G).

Design spec (D19):
  delta = dashboard_ar + exception_bucket_total - tally_xero_closing_ar
  MATCHED:    abs(delta) <= 100
  MISMATCHED: abs(delta) > 100
  UNRECONCILED: no entry yet

RBAC per ADR-0006 (D19 vs §9 resolution):
  ANALYST read+write (entity-scoped), ADMIN read+write (any entity),
  CFO read-only (403 on POST), PENDING 403 everywhere.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.reconciliation_entry import ReconciliationEntry
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth helpers (minimal, same pattern as publish tests)
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient,
    db_session: Session,
    email: str = "analyst@emb.global",
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    user.entity_id_scope = None
    user.is_active = True
    db_session.flush()


def _login_as_cfo(
    client: TestClient, db_session: Session, email: str = "cfo@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


# ---------------------------------------------------------------------------
# DB helpers — build a published snapshot with known invoice data
# ---------------------------------------------------------------------------


def _admin_id(db_session: Session) -> uuid.UUID:
    u = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return cast(uuid.UUID, u.id)


def _entity_id(db_session: Session, code: str = "IND") -> uuid.UUID:
    e = db_session.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return cast(uuid.UUID, e.id)


def _build_published_snapshot(
    db_session: Session,
    as_of_date: date = date(2026, 3, 31),
    invoice_outstanding: Decimal = Decimal("10000"),
    entity_code: str = "IND",
    snap_ref: str = "RECON-TEST",
) -> uuid.UUID:
    """Build a PUBLISHED snapshot with one OPEN invoice and one invoice_snapshot row."""
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)

    canonical = PartyCanonical(entity_id=entity_id, name=f"ReconParty-{snap_ref}", created_by=admin)
    db_session.add(canonical)
    db_session.flush()

    snapshot = Snapshot(
        entity_id=entity_id,
        as_of_date=as_of_date,
        status="PUBLISHED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
    )
    db_session.add(snapshot)
    db_session.flush()

    invoice = Invoice(
        invoice_ref=f"{snap_ref}-INV",
        invoice_date=date(2026, 1, 15),
        amount=invoice_outstanding,
        currency="INR",
        due_date=date(2026, 2, 14),
        status="OPEN",
        entity_id=entity_id,
        canonical_id=canonical.id,
        first_seen_snapshot_id=snapshot.id,
        credit_days_applied=30,
        credit_days_source="MANUAL",
        raw_row_json={},
    )
    db_session.add(invoice)
    db_session.flush()

    inv_snap = InvoiceSnapshot(
        snapshot_id=snapshot.id,
        invoice_id=invoice.id,
        as_of_date=as_of_date,
        outstanding_amount=invoice_outstanding,
        overdue_days=45,
        bucket="31_60",
    )
    db_session.add(inv_snap)
    db_session.flush()

    return cast(uuid.UUID, snapshot.id)


def _add_active_exception(
    db_session: Session, snapshot_id: uuid.UUID, extra_amount: Decimal = Decimal("500")
) -> None:
    """Add an ACTIVE exception tag to the invoice in the given snapshot."""
    admin = _admin_id(db_session)
    # Get the invoice snapshot row
    inv_snap = db_session.scalar(
        select(InvoiceSnapshot).where(InvoiceSnapshot.snapshot_id == snapshot_id)
    )
    assert inv_snap is not None

    bucket = db_session.scalar(
        select(ExceptionBucketType).where(
            ExceptionBucketType.active.is_(True)
        )
    )
    assert bucket is not None

    tag = ExceptionTag(
        invoice_id=inv_snap.invoice_id,
        bucket_type_id=bucket.id,
        reason="Test exception",
        tagged_by=admin,
        status="ACTIVE",
    )
    db_session.add(tag)
    db_session.flush()


# ---------------------------------------------------------------------------
# GET /snapshots/:id/reconciliation
# ---------------------------------------------------------------------------


def test_get_reconciliation_unreconciled_for_published_snapshot(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    snap_id = _build_published_snapshot(db_session, snap_ref="GR01")

    resp = client.get(f"/snapshots/{snap_id}/reconciliation")
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["status"] == "UNRECONCILED"
    assert body["tally_xero_closing_ar"] is None
    assert body["delta"] is None
    assert Decimal(str(body["dashboard_ar"])) > 0


def test_get_reconciliation_404_unknown_snapshot(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    resp = client.get(f"/snapshots/{uuid.uuid4()}/reconciliation")
    assert resp.status_code == 404


def test_get_reconciliation_409_non_published_snapshot(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    entity_id = _entity_id(db_session)
    admin = _admin_id(db_session)
    snap = Snapshot(entity_id=entity_id, as_of_date=date(2026, 3, 31), status="STAGED", source_hint="TALLY", upload_file_sha256=uuid.uuid4().hex, uploaded_by=admin)
    db_session.add(snap)
    db_session.flush()

    resp = client.get(f"/snapshots/{snap.id}/reconciliation")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "SNAPSHOT_NOT_PUBLISHED"


def test_get_reconciliation_analyst_can_read(
    client: TestClient, db_session: Session
) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    snap_id = _build_published_snapshot(db_session, snap_ref="GR02")

    resp = client.get(f"/snapshots/{snap_id}/reconciliation")
    assert resp.status_code == 200


def test_get_reconciliation_cfo_can_read(
    client: TestClient, db_session: Session
) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    snap_id = _build_published_snapshot(db_session, snap_ref="GR03")

    resp = client.get(f"/snapshots/{snap_id}/reconciliation")
    assert resp.status_code == 200


def test_get_reconciliation_shows_exception_bucket_total(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    snap_id = _build_published_snapshot(
        db_session, invoice_outstanding=Decimal("10000"), snap_ref="GR04"
    )
    _add_active_exception(db_session, snap_id)

    resp = client.get(f"/snapshots/{snap_id}/reconciliation")
    assert resp.status_code == 200
    body = resp.json()
    # Exception bucket total should equal the invoice outstanding (the invoice has an ACTIVE tag)
    assert Decimal(str(body["exception_bucket_total"])) == Decimal("10000")


# ---------------------------------------------------------------------------
# POST /snapshots/:id/reconciliation
# ---------------------------------------------------------------------------


def _post_reconciliation(
    client: TestClient,
    snap_id: uuid.UUID,
    tally_ar: float,
    notes: str | None = None,
) -> Any:
    body: dict[str, Any] = {"tally_xero_closing_ar": str(tally_ar)}
    if notes:
        body["notes"] = notes
    return client.post(
        f"/snapshots/{snap_id}/reconciliation",
        json=body,
        headers=_headers(client),
    )


def test_post_reconciliation_matched_status(
    client: TestClient, db_session: Session
) -> None:
    """dashboard_ar=10000, exception_bucket=0, tally=10000 → delta=0 → MATCHED."""
    _login_as_admin(client)
    snap_id = _build_published_snapshot(
        db_session, invoice_outstanding=Decimal("10000"), snap_ref="PR01"
    )

    resp = _post_reconciliation(client, snap_id, tally_ar=10000.0)
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["status"] == "MATCHED"
    assert Decimal(str(body["delta"])) == Decimal("0")


def test_post_reconciliation_matched_within_tolerance(
    client: TestClient, db_session: Session
) -> None:
    """Delta = 50 (<=100) → MATCHED."""
    _login_as_admin(client)
    snap_id = _build_published_snapshot(
        db_session, invoice_outstanding=Decimal("10000"), snap_ref="PR02"
    )

    resp = _post_reconciliation(client, snap_id, tally_ar=9950.0)
    assert resp.status_code == 200
    assert resp.json()["status"] == "MATCHED"


def test_post_reconciliation_mismatched_status(
    client: TestClient, db_session: Session
) -> None:
    """Delta > 100 → MISMATCHED."""
    _login_as_admin(client)
    snap_id = _build_published_snapshot(
        db_session, invoice_outstanding=Decimal("10000"), snap_ref="PR03"
    )

    resp = _post_reconciliation(client, snap_id, tally_ar=9000.0)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "MISMATCHED"
    assert Decimal(str(body["delta"])) == Decimal("1000")


def test_post_reconciliation_delta_formula_d19(
    client: TestClient, db_session: Session
) -> None:
    """delta = dashboard_ar + exception_bucket_total - tally_xero_closing_ar (D19)."""
    _login_as_admin(client)
    snap_id = _build_published_snapshot(
        db_session, invoice_outstanding=Decimal("10000"), snap_ref="PR04"
    )
    _add_active_exception(db_session, snap_id)

    # dashboard_ar=10000, exception_bucket=10000, tally=15000
    # delta = 10000 + 10000 - 15000 = 5000 → MISMATCHED
    resp = _post_reconciliation(client, snap_id, tally_ar=15000.0)
    assert resp.status_code == 200
    body = resp.json()
    assert Decimal(str(body["delta"])) == Decimal("5000")
    assert body["status"] == "MISMATCHED"


def test_post_reconciliation_upsert_updates_existing(
    client: TestClient, db_session: Session
) -> None:
    """A second POST replaces the existing entry."""
    _login_as_admin(client)
    snap_id = _build_published_snapshot(
        db_session, invoice_outstanding=Decimal("10000"), snap_ref="PR05"
    )

    # First POST
    r1 = _post_reconciliation(client, snap_id, tally_ar=9000.0)
    assert r1.status_code == 200
    assert r1.json()["status"] == "MISMATCHED"

    # Second POST (now MATCHED)
    r2 = _post_reconciliation(client, snap_id, tally_ar=10000.0)
    assert r2.status_code == 200
    assert r2.json()["status"] == "MATCHED"

    # DB should have only one entry
    count = db_session.query(ReconciliationEntry).filter(
        ReconciliationEntry.snapshot_id == snap_id
    ).count()
    assert count == 1


def test_post_reconciliation_allowed_for_analyst_in_scope(
    client: TestClient, db_session: Session
) -> None:
    """ADR-0006: ANALYST writes reconciliation for their scoped entity (200)."""
    _login_as_analyst(client, db_session, "analyst@emb.global")
    snap_id = _build_published_snapshot(db_session, snap_ref="PR06", entity_code="IND")

    resp = _post_reconciliation(client, snap_id, tally_ar=10000.0)
    assert resp.status_code == 200, resp.json()


def test_post_reconciliation_allowed_for_analyst_with_no_scope(
    client: TestClient, db_session: Session
) -> None:
    """ANALYST with NULL entity_id_scope (explicit all-entity scope) writes any entity."""
    _login_as_analyst(client, db_session, "analyst@emb.global")
    snap_id = _build_published_snapshot(db_session, snap_ref="PR06B", entity_code="UAE")

    resp = _post_reconciliation(client, snap_id, tally_ar=10000.0)
    assert resp.status_code == 200, resp.json()


def test_post_reconciliation_403_for_analyst_out_of_scope(
    client: TestClient, db_session: Session
) -> None:
    """ADR-0006: ANALYST scoped to IND attempting to reconcile a UAE snapshot → 403."""
    _login_as_analyst(client, db_session, "analyst@emb.global")
    # Scope the analyst to IND
    user = db_session.scalar(select(User).where(User.email == "analyst@emb.global"))
    assert user is not None
    user.entity_id_scope = _entity_id(db_session, "IND")
    db_session.flush()

    uae_snap_id = _build_published_snapshot(db_session, snap_ref="PR06C", entity_code="UAE")

    resp = _post_reconciliation(client, uae_snap_id, tally_ar=10000.0)
    assert resp.status_code == 403


def test_post_reconciliation_403_for_cfo(
    client: TestClient, db_session: Session
) -> None:
    """ADR-0006: CFO is read-only — POST returns 403."""
    _login_as_cfo(client, db_session, "cfo@emb.global")
    snap_id = _build_published_snapshot(db_session, snap_ref="PR07")

    resp = _post_reconciliation(client, snap_id, tally_ar=10000.0)
    assert resp.status_code == 403


def test_post_reconciliation_409_non_published(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    entity_id = _entity_id(db_session)
    admin = _admin_id(db_session)
    snap = Snapshot(entity_id=entity_id, as_of_date=date(2026, 3, 31), status="STAGED", source_hint="TALLY", upload_file_sha256=uuid.uuid4().hex, uploaded_by=admin)
    db_session.add(snap)
    db_session.flush()

    resp = _post_reconciliation(client, snap.id, tally_ar=10000.0)
    assert resp.status_code == 409


def test_post_reconciliation_404_unknown_snapshot(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    resp = _post_reconciliation(client, uuid.uuid4(), tally_ar=10000.0)
    assert resp.status_code == 404


def test_post_reconciliation_with_notes(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    snap_id = _build_published_snapshot(db_session, snap_ref="PR08")

    resp = _post_reconciliation(client, snap_id, tally_ar=10000.0, notes="Checked manually")
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Checked manually"


def test_post_reconciliation_populates_entered_by(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    snap_id = _build_published_snapshot(db_session, snap_ref="PR09")

    resp = _post_reconciliation(client, snap_id, tally_ar=10000.0)
    assert resp.status_code == 200
    body = resp.json()
    assert body["entered_by"] is not None
    assert body["entered_by"]["email"] == "tejaswa.sharma@emb.global"


def test_get_reconciliation_returns_existing_entry_after_post(
    client: TestClient, db_session: Session
) -> None:
    """GET after POST should return the persisted entry, not a dry-run."""
    _login_as_admin(client)
    snap_id = _build_published_snapshot(db_session, snap_ref="PR10")

    _post_reconciliation(client, snap_id, tally_ar=9500.0, notes="Verified")

    resp = client.get(f"/snapshots/{snap_id}/reconciliation")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in ("MATCHED", "MISMATCHED")
    assert body["notes"] == "Verified"
    assert body["tally_xero_closing_ar"] is not None
