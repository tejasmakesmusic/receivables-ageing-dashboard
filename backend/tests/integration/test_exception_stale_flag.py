"""Integration tests for D12 stale follow-up flag on exception list rows.

Spec:
  is_stale = ACTIVE AND NOT excluded AND (
      (last_follow_up_date IS NOT NULL AND last_follow_up_date < today - 7d)
      OR
      (last_follow_up_date IS NULL AND tagged_at::date < today - 7d)
  )

Test matrix (today = 2026-04-19 per CLAUDE.md):
  1. ACTIVE, no follow-up, tagged >7 days ago          → is_stale=True
  2. ACTIVE, last_follow_up 3 days ago                 → is_stale=False
  3. ACTIVE, last_follow_up 10 days ago                → is_stale=True
  4. RESOLVED exception                                → is_stale=False
  5. Excluded exception                                → is_stale=False
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.follow_up import FollowUp
from app.db.models.invoice import Invoice
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TODAY = datetime.now(tz=UTC).date()


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


def _admin_id(db: Session) -> uuid.UUID:
    u = db.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert u is not None
    return cast(uuid.UUID, u.id)


def _entity_id(db: Session, code: str = "IND") -> uuid.UUID:
    e = db.scalar(select(Entity).where(Entity.code == code))
    assert e is not None
    return cast(uuid.UUID, e.id)


def _bucket_id(db: Session, code: str = "DISPUTED") -> uuid.UUID:
    bt = db.scalar(
        select(ExceptionBucketType).where(
            ExceptionBucketType.code == code,
            ExceptionBucketType.active.is_(True),
        )
    )
    assert bt is not None, f"ExceptionBucketType '{code}' not seeded"
    return cast(uuid.UUID, bt.id)


def _make_invoice(db: Session, ref: str) -> tuple[uuid.UUID, uuid.UUID]:
    """Return (invoice_id, canonical_id)."""
    admin = _admin_id(db)
    ent_id = _entity_id(db)

    snap = Snapshot(
        entity_id=ent_id,
        as_of_date=date(2026, 1, 31),
        status="PUBLISHED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
    )
    db.add(snap)
    db.flush()

    canonical = PartyCanonical(entity_id=ent_id, name=f"StaleParty-{ref}", created_by=admin)
    db.add(canonical)
    db.flush()

    invoice = Invoice(
        invoice_ref=ref,
        invoice_date=date(2026, 1, 15),
        amount=10000.0,
        currency="INR",
        due_date=date(2026, 2, 14),
        status="OPEN",
        entity_id=ent_id,
        canonical_id=canonical.id,
        first_seen_snapshot_id=snap.id,
        credit_days_applied=30,
        credit_days_source="MANUAL",
        raw_row_json={},
    )
    db.add(invoice)
    db.flush()
    return cast(uuid.UUID, invoice.id), cast(uuid.UUID, canonical.id)


def _make_tag(
    db: Session,
    invoice_id: uuid.UUID,
    tagged_ago_days: int,
    status: str = "ACTIVE",
    exclude: bool = False,
) -> uuid.UUID:
    """Insert an ExceptionTag with tagged_at = now - tagged_ago_days."""
    admin = _admin_id(db)
    bt_id = _bucket_id(db)
    tagged_at = datetime.now(tz=UTC) - timedelta(days=tagged_ago_days)

    tag = ExceptionTag(
        invoice_id=invoice_id,
        bucket_type_id=bt_id,
        reason="stale test",
        tagged_by=admin,
        tagged_at=tagged_at,
        status=status,
    )
    if status == "RESOLVED":
        tag.resolved_at = datetime.now(tz=UTC)
        tag.resolved_by = admin
    if exclude:
        tag.excluded_at = datetime.now(tz=UTC)
        tag.excluded_reason = "OTHER"
        tag.excluded_reason_note = "test exclusion"
        tag.excluded_by = admin
    db.add(tag)
    db.flush()
    return cast(uuid.UUID, tag.id)


def _add_follow_up(
    db: Session,
    canonical_id: uuid.UUID,
    invoice_id: uuid.UUID,
    days_ago: int,
) -> None:
    admin = _admin_id(db)
    fu = FollowUp(
        canonical_id=canonical_id,
        invoice_id=invoice_id,
        date=TODAY - timedelta(days=days_ago),
        channel="EMAIL",
        logged_by=admin,
    )
    db.add(fu)
    db.flush()


def _list_exceptions(client: TestClient) -> list[dict]:
    resp = client.get("/exceptions?page=1&page_size=100&status=ACTIVE")
    assert resp.status_code == 200, resp.json()
    return resp.json()["items"]


def _list_all_exceptions(client: TestClient) -> list[dict]:
    resp = client.get("/exceptions?page=1&page_size=100&include_excluded=true")
    assert resp.status_code == 200, resp.json()
    return resp.json()["items"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_stale_no_followup_tagged_old(client: TestClient, db_session: Session) -> None:
    """ACTIVE, no follow-up, tagged 10 days ago → is_stale=True."""
    _login(client, "tejaswa.sharma@emb.global")

    inv_id, _ = _make_invoice(db_session, ref=f"INV-STALE-1-{uuid.uuid4().hex[:6]}")
    tag_id = _make_tag(db_session, inv_id, tagged_ago_days=10)

    items = _list_exceptions(client)
    match = next((i for i in items if i["id"] == str(tag_id)), None)
    assert match is not None, "Tag not found in list response"
    assert match["is_stale"] is True, f"Expected is_stale=True, got {match['is_stale']}"


def test_not_stale_recent_followup(client: TestClient, db_session: Session) -> None:
    """ACTIVE, last follow-up 3 days ago → is_stale=False."""
    _login(client, "tejaswa.sharma@emb.global")

    inv_id, can_id = _make_invoice(db_session, ref=f"INV-STALE-2-{uuid.uuid4().hex[:6]}")
    tag_id = _make_tag(db_session, inv_id, tagged_ago_days=10)
    _add_follow_up(db_session, can_id, inv_id, days_ago=3)

    items = _list_exceptions(client)
    match = next((i for i in items if i["id"] == str(tag_id)), None)
    assert match is not None, "Tag not found in list response"
    assert match["is_stale"] is False, f"Expected is_stale=False, got {match['is_stale']}"


def test_stale_old_followup(client: TestClient, db_session: Session) -> None:
    """ACTIVE, last follow-up 10 days ago → is_stale=True."""
    _login(client, "tejaswa.sharma@emb.global")

    inv_id, can_id = _make_invoice(db_session, ref=f"INV-STALE-3-{uuid.uuid4().hex[:6]}")
    tag_id = _make_tag(db_session, inv_id, tagged_ago_days=15)
    _add_follow_up(db_session, can_id, inv_id, days_ago=10)

    items = _list_exceptions(client)
    match = next((i for i in items if i["id"] == str(tag_id)), None)
    assert match is not None, "Tag not found in list response"
    assert match["is_stale"] is True, f"Expected is_stale=True, got {match['is_stale']}"


def test_resolved_not_stale(client: TestClient, db_session: Session) -> None:
    """RESOLVED exception → is_stale=False regardless of follow-up age."""
    _login(client, "tejaswa.sharma@emb.global")

    inv_id, _ = _make_invoice(db_session, ref=f"INV-STALE-4-{uuid.uuid4().hex[:6]}")
    tag_id = _make_tag(db_session, inv_id, tagged_ago_days=30, status="RESOLVED")

    # Fetch all statuses
    resp = client.get("/exceptions?page=1&page_size=100")
    assert resp.status_code == 200
    items = resp.json()["items"]
    match = next((i for i in items if i["id"] == str(tag_id)), None)
    assert match is not None, "Resolved tag not found in list response"
    assert match["is_stale"] is False, f"RESOLVED tag should never be stale, got {match['is_stale']}"


def test_excluded_not_stale(client: TestClient, db_session: Session) -> None:
    """Excluded exception → is_stale=False."""
    _login(client, "tejaswa.sharma@emb.global")

    inv_id, _ = _make_invoice(db_session, ref=f"INV-STALE-5-{uuid.uuid4().hex[:6]}")
    tag_id = _make_tag(db_session, inv_id, tagged_ago_days=30, exclude=True)

    items = _list_all_exceptions(client)
    match = next((i for i in items if i["id"] == str(tag_id)), None)
    assert match is not None, "Excluded tag not found in list response"
    assert match["is_stale"] is False, f"Excluded tag should never be stale, got {match['is_stale']}"


def test_not_stale_tagged_within_grace_period(
    client: TestClient, db_session: Session
) -> None:
    """ACTIVE, no follow-up, tagged only 3 days ago → is_stale=False (grace period)."""
    _login(client, "tejaswa.sharma@emb.global")

    inv_id, _ = _make_invoice(db_session, ref=f"INV-STALE-6-{uuid.uuid4().hex[:6]}")
    tag_id = _make_tag(db_session, inv_id, tagged_ago_days=3)

    items = _list_exceptions(client)
    match = next((i for i in items if i["id"] == str(tag_id)), None)
    assert match is not None, "Tag not found in list response"
    assert match["is_stale"] is False, (
        f"Tag within 7-day grace period should not be stale, got {match['is_stale']}"
    )
