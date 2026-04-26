"""Integration test: GET /snapshots/{id} returns enriched material_change_flags.

Scenario:
  - Build a Snapshot row in PUBLISHED state whose material_change_flags_json
    contains one entry referencing a real Invoice + PartyCanonical row.
  - Call GET /snapshots/{id}.
  - Assert the response contains material_change_flags with invoice_ref and
    canonical_name populated (not "UNKNOWN").
  - Assert the response is None / omitted when the flags list is empty.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.db.models.entity import Entity
from app.db.models.invoice import Invoice
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth helpers (re-used pattern from test_golden_path_e2e.py)
# ---------------------------------------------------------------------------

ADMIN_EMAIL = "tejaswa.sharma@emb.global"


def _login_as_admin(client: TestClient) -> None:
    client.get(f"/auth/google/callback?stub_email={ADMIN_EMAIL}", follow_redirects=False)


def _csrf_headers(client: TestClient) -> dict[str, str]:
    tok = client.cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": tok} if tok else {}


# ---------------------------------------------------------------------------
# Helpers to build minimal DB fixtures
# ---------------------------------------------------------------------------


def _get_or_create_canonical(
    db: Session,
    entity_id: uuid.UUID,
    name: str,
    created_by: uuid.UUID,
) -> PartyCanonical:
    existing = db.scalar(
        select(PartyCanonical).where(
            PartyCanonical.entity_id == entity_id,
            PartyCanonical.name == name,
        )
    )
    if existing:
        return existing
    pc = PartyCanonical(entity_id=entity_id, name=name, created_by=created_by)
    db.add(pc)
    db.flush()
    return pc


def _build_invoice(
    db: Session,
    entity_id: uuid.UUID,
    canonical_id: uuid.UUID,
    invoice_ref: str,
    amount: Decimal,
    snapshot_id: uuid.UUID,
) -> Invoice:
    inv = Invoice(
        entity_id=entity_id,
        canonical_id=canonical_id,
        invoice_ref=invoice_ref,
        invoice_date=date(2026, 3, 1),
        amount=amount,
        currency="INR",
        credit_days_applied=30,
        credit_days_source="DEFAULT",
        due_date=date(2026, 4, 1),
        status="OPEN",
        first_seen_snapshot_id=snapshot_id,
        raw_row_json={},
    )
    db.add(inv)
    db.flush()
    return inv


def _build_snapshot(
    db: Session,
    entity_id: uuid.UUID,
    uploaded_by: uuid.UUID,
    material_flags: list[dict[str, Any]],
    status: str = "PUBLISHED",
) -> Snapshot:
    snap = Snapshot(
        entity_id=entity_id,
        uploaded_by=uploaded_by,
        upload_file_sha256=uuid.uuid4().hex,  # unique per test
        as_of_date=date(2026, 3, 31),
        source_hint="TALLY",
        status=status,
        row_count=1,
        total_outstanding=Decimal("10000.00"),
        parse_result_json={"warnings": [], "rows": []},
        warnings_acknowledged_json=[],
        staging_overrides_json=[],
        material_change_flags_json=material_flags,
        published_at=datetime.now(tz=UTC) if status == "PUBLISHED" else None,
        published_by=uploaded_by if status == "PUBLISHED" else None,
        published_as="NORMAL" if status == "PUBLISHED" else None,
    )
    db.add(snap)
    db.flush()
    return snap


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMaterialChangeBannerRoute:
    """GET /snapshots/{id} — material_change_flags enrichment."""

    def test_flags_enriched_with_invoice_ref_and_canonical_name(
        self, client: TestClient, db_session: Session
    ) -> None:
        """When material_change_flags_json is non-empty, the route enriches
        each entry with invoice_ref and canonical_name from the DB."""
        _login_as_admin(client)

        # Fetch the seeded IND entity and admin user
        ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
        assert ind is not None, "IND entity must be seeded by migrations"

        admin_user = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
        assert admin_user is not None, "Admin user must exist after login"

        # Build a placeholder snapshot (published) to satisfy FK on Invoice
        placeholder_snap = _build_snapshot(
            db=db_session,
            entity_id=ind.id,
            uploaded_by=admin_user.id,
            material_flags=[],
            status="PUBLISHED",
        )

        # Build canonical + invoice
        canonical = _get_or_create_canonical(
            db=db_session,
            entity_id=ind.id,
            name="BannerTest Corp Pvt Ltd",
            created_by=admin_user.id,
        )
        inv = _build_invoice(
            db=db_session,
            entity_id=ind.id,
            canonical_id=canonical.id,
            invoice_ref="BANNER-INV-001",
            amount=Decimal("892000.00"),
            snapshot_id=placeholder_snap.id,
        )

        # Now build the actual snapshot carrying flags that reference this invoice
        flags = [
            {
                "invoice_id": str(inv.id),
                "prior_amount": "845000.00",
                "new_amount": "892000.00",
                "delta_pct": "5.62",
            }
        ]
        snap = _build_snapshot(
            db=db_session,
            entity_id=ind.id,
            uploaded_by=admin_user.id,
            material_flags=flags,
            status="PUBLISHED",
        )
        db_session.flush()

        resp = client.get(f"/snapshots/{snap.id}")
        assert resp.status_code == 200, resp.text

        body = resp.json()
        assert body["material_change_flags"] is not None
        assert len(body["material_change_flags"]) == 1

        flag = body["material_change_flags"][0]
        assert flag["invoice_ref"] == "BANNER-INV-001"
        assert flag["canonical_name"] == "BannerTest Corp Pvt Ltd"
        assert flag["invoice_id"] == str(inv.id)
        # Decimals are serialised as strings on the wire
        assert flag["prior_amount"] == "845000.00"
        assert flag["new_amount"] == "892000.00"
        assert flag["delta_pct"] == "5.62"

    def test_flags_none_when_empty(self, client: TestClient, db_session: Session) -> None:
        """When material_change_flags_json is empty, the field is None in the response."""
        _login_as_admin(client)

        ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
        assert ind is not None

        admin_user = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
        assert admin_user is not None

        snap = _build_snapshot(
            db=db_session,
            entity_id=ind.id,
            uploaded_by=admin_user.id,
            material_flags=[],
            status="PUBLISHED",
        )
        db_session.flush()

        resp = client.get(f"/snapshots/{snap.id}")
        assert resp.status_code == 200, resp.text

        body = resp.json()
        # Empty flags → field should be null (None), not an empty list
        assert body["material_change_flags"] is None

    def test_flags_none_for_staged_snapshot(self, client: TestClient, db_session: Session) -> None:
        """STAGED snapshots have no flags — field is None."""
        _login_as_admin(client)

        ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
        assert ind is not None

        admin_user = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
        assert admin_user is not None

        snap = _build_snapshot(
            db=db_session,
            entity_id=ind.id,
            uploaded_by=admin_user.id,
            material_flags=[],
            status="STAGED",
        )
        db_session.flush()

        resp = client.get(f"/snapshots/{snap.id}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["material_change_flags"] is None
