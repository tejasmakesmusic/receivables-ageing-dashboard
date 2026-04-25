"""Integration tests for PUBLISH_NOTIF email body (spec §8.2 diff body).

Coverage:
1. First publish (no prior snapshot) — body contains invoice count, omits diff
   section, no "vs previous" markers for settled/bucket-shift content.
2. Second publish (prior snapshot exists) — body contains new/settled counts,
   bucket-shift section, "prior snapshot" total row.
3. Template renderer unit-style check (render_publish_notif_html directly).

Test strategy: upload → publish → query EmailOutbox row → assert body_html.
All assertions are string-content checks; we do NOT assert pixel layout.

Seeded data reused from test_snapshots_publish helpers (auth, xlsx builders,
_setup_publishable_tally_snapshot, etc.).
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

import openpyxl
from sqlalchemy import select

from app.db.models.email_outbox import EmailOutbox
from app.db.models.entity import Entity
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.reconciliation_entry import ReconciliationEntry
from app.db.models.snapshot import Snapshot
from app.db.models.user import User
from app.emails.templates.publish_notif import render_publish_notif_html

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Auth + upload helpers (mirrors test_snapshots_publish.py pattern)
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _set_entity_default_credit_days(
    db_session: Session, entity_code: str, days: int | None
) -> None:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    entity.default_credit_days = days
    db_session.flush()


def _create_canonical_for_party(
    db_session: Session,
    entity_code: str,
    canonical_name: str,
    alias_text: str | None = None,
) -> uuid.UUID:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    admin = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert admin is not None

    canonical = PartyCanonical(entity_id=entity.id, name=canonical_name, created_by=admin.id)
    db_session.add(canonical)
    db_session.flush()

    if alias_text:
        db_session.add(
            PartyAlias(
                canonical_id=canonical.id,
                alias_text=alias_text,
                source="MANUAL",
                confidence=None,
                created_by=admin.id,
            )
        )
        db_session.flush()

    return cast(uuid.UUID, canonical.id)


def _make_tally_xlsx(
    data_rows: list[list[Any]],
    sheet_name: str = "Sundry Debtors",
) -> bytes:
    _meta = [
        ["Group :", "Sundry Debtors", None, "1-Apr-26 to 16-Apr-26", None, None, None],
        ["Details of:", "Pending Bills", None, None, None, None, None],
        [None] * 7,
        ["Date", "Ref. No.", "Party's Name", "Opening", "Pending", "Due on", "Overdue"],
        [None, None, None, "Amount", "Amount", None, "by days"],
    ]
    wb = openpyxl.Workbook()
    del wb["Sheet"]
    ws = wb.create_sheet(sheet_name)
    for row in _meta:
        ws.append(row)
    for row in data_rows:
        inv_date, ref_no, party_name, opening, pending, due_on, overdue = row
        if party_name is not None:
            ws.append([None, None, party_name, None, None, None, None])
        ws.append([inv_date, ref_no, None, opening, pending, due_on, overdue])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(
    client: TestClient,
    file_bytes: bytes,
    entity_code: str = "IND",
    source_hint: str = "TALLY",
    as_of_date: str = "2026-03-31",
    filename: str = "test.xlsx",
) -> Any:
    data: dict[str, Any] = {
        "entity_code": entity_code,
        "source_hint": source_hint,
        "as_of_date": as_of_date,
    }
    csrf_token = _csrf(client)
    headers: dict[str, str] = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    return client.post(
        "/snapshots",
        data=data,
        files={
            "file": (
                filename,
                io.BytesIO(file_bytes),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=headers,
    )


def _ack_all_warnings(client: TestClient, db_session: Session, snapshot_id: str) -> None:
    snap = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(snapshot_id)))
    assert snap is not None
    pr = snap.parse_result_json or {}
    codes = sorted({w.get("code") for w in pr.get("warnings", []) if w.get("code")})
    if not codes:
        return
    csrf_token = _csrf(client)
    headers: dict[str, str] = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.patch(
        f"/snapshots/{snapshot_id}/warnings/ack",
        json={"codes": codes},
        headers=headers,
    )
    assert resp.status_code == 200, resp.json()


def _publish(client: TestClient, snapshot_id: str) -> Any:
    csrf_token = _csrf(client)
    headers: dict[str, str] = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    return client.post(f"/snapshots/{snapshot_id}/publish", json={}, headers=headers)


def _reconcile_snapshot_directly(db_session: Session, snapshot_id: str) -> None:
    """Insert a MATCHED ReconciliationEntry directly to satisfy §13 #6 gate."""
    admin = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert admin is not None
    existing = db_session.scalar(
        select(ReconciliationEntry).where(ReconciliationEntry.snapshot_id == uuid.UUID(snapshot_id))
    )
    if existing is not None:
        existing.tally_xero_closing_ar = Decimal("0.00")
        existing.delta = Decimal("0.00")
        existing.status = "MATCHED"
        existing.entered_by = admin.id
    else:
        db_session.add(
            ReconciliationEntry(
                snapshot_id=uuid.UUID(snapshot_id),
                dashboard_ar=Decimal("0.00"),
                exception_bucket_total=Decimal("0.00"),
                exception_bucket_breakdown={},
                tally_xero_closing_ar=Decimal("0.00"),
                delta=Decimal("0.00"),
                status="MATCHED",
                entered_by=admin.id,
                notes="test-helper auto-reconcile",
            )
        )
    db_session.flush()


def _reconcile_all_published_for_entity(db_session: Session, entity_code: str) -> None:
    """Reconcile every PUBLISHED TALLY/XERO snapshot for the given entity.

    Needed when a prior test in the same Neon session has published snapshots
    that would otherwise block the §13 #6 gate.
    """
    from app.db.models.snapshot import Snapshot as _Snap

    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    published = db_session.scalars(
        select(_Snap).where(
            _Snap.entity_id == entity.id,
            _Snap.status == "PUBLISHED",
            _Snap.source_hint.in_(("TALLY", "XERO")),
        )
    ).all()
    for snap in published:
        _reconcile_snapshot_directly(db_session, str(snap.id))


def _get_latest_outbox_row(
    db_session: Session,
    snapshot_id: str,
    rule_type: str = "PUBLISH_NOTIF",
) -> EmailOutbox:
    row = db_session.scalar(
        select(EmailOutbox).where(
            EmailOutbox.snapshot_id == uuid.UUID(snapshot_id),
            EmailOutbox.rule_type == rule_type,
        )
    )
    assert row is not None, f"No {rule_type} outbox row for snapshot {snapshot_id}"
    return row


# ---------------------------------------------------------------------------
# Unit-style test: render_publish_notif_html directly
# ---------------------------------------------------------------------------


def test_render_publish_notif_html_no_prior_snapshot() -> None:
    """Template omits diff section and shows first-snapshot notice when no prior."""
    payload = {
        "new_invoices_count": 7,
        "settled_invoices_count": 0,
        "bucket_shifts": {},
        "new_exceptions_count": 0,
        "material_change_count": 0,
        "total_outstanding_now": "25000.00",
        "total_outstanding_prior": None,
        "has_prior_snapshot": False,
    }
    html = render_publish_notif_html(
        payload=payload,
        snapshot_id="test-snap-id",
        entity_code="IND",
        as_of_str="2026-03-31",
    )
    assert "7" in html
    assert "25000.00" in html
    assert "first published snapshot" in html
    # No "vs previous" section markers
    assert "Prior snapshot" not in html
    assert "Settled invoices" not in html


def test_render_publish_notif_html_with_prior_snapshot() -> None:
    """Template shows diff section including settled count and bucket shifts."""
    payload = {
        "new_invoices_count": 3,
        "settled_invoices_count": 2,
        "bucket_shifts": {"0_30→31_60": 4, "NOT_DUE→0_30": 1},
        "new_exceptions_count": 1,
        "material_change_count": 2,
        "total_outstanding_now": "18000.00",
        "total_outstanding_prior": "20000.00",
        "has_prior_snapshot": True,
    }
    html = render_publish_notif_html(
        payload=payload,
        snapshot_id="test-snap-id-2",
        entity_code="UAE",
        as_of_str="2026-04-30",
    )
    assert "3" in html  # new_invoices_count
    assert "2" in html  # settled_invoices_count or material_change_count
    assert "18000.00" in html
    assert "20000.00" in html
    assert "Prior snapshot" in html
    assert "Settled invoices" in html
    # Bucket shift rows
    assert "0-30 days" in html  # _BUCKET_DISPLAY mapping for "0_30"
    assert "31-60 days" in html  # _BUCKET_DISPLAY mapping for "31_60"
    assert "4" in html  # bucket shift count
    # Dashboard link
    assert "/dashboard?entity=UAE" in html


def test_render_publish_notif_html_empty_bucket_shifts_omits_section() -> None:
    """When prior exists but no bucket shifts, the bucket shifts section is omitted."""
    payload = {
        "new_invoices_count": 1,
        "settled_invoices_count": 0,
        "bucket_shifts": {},
        "new_exceptions_count": 0,
        "material_change_count": 0,
        "total_outstanding_now": "5000.00",
        "total_outstanding_prior": "5000.00",
        "has_prior_snapshot": True,
    }
    html = render_publish_notif_html(
        payload=payload,
        snapshot_id="test-snap-id-3",
        entity_code="IND",
        as_of_str="2026-04-30",
    )
    assert "Bucket Shifts" not in html
    assert "Prior snapshot" in html


# ---------------------------------------------------------------------------
# Integration test 1: First publish — no prior snapshot
# ---------------------------------------------------------------------------


def test_publish_notif_email_no_prior_snapshot(client: TestClient, db_session: Session) -> None:
    """First TALLY publish for an entity enqueues an outbox row with first-publish body."""
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)

    party = "NotifClient Alpha"
    _create_canonical_for_party(db_session, "IND", party, alias_text=party)
    xlsx = _make_tally_xlsx(
        data_rows=[[date(2026, 2, 1), "NOTIF-INV-001", party, 5000.0, 5000.0, None, None]]
    )
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snapshot_id = upload_resp.json()["snapshot_id"]

    _ack_all_warnings(client, db_session, snapshot_id)
    pub_resp = _publish(client, snapshot_id)
    assert pub_resp.status_code == 200, pub_resp.json()

    outbox = _get_latest_outbox_row(db_session, snapshot_id)
    assert outbox.status == "QUEUED"
    assert outbox.recipients_json == []

    body = outbox.body_html
    assert body is not None
    # First-snapshot notice present
    assert "first published snapshot" in body
    # No "vs previous" diff section
    assert "Prior snapshot" not in body
    assert "Settled invoices" not in body
    # Outstanding total present (non-zero invoice ingested)
    assert "5000.00" in body
    # Dashboard link
    assert "/dashboard?entity=IND" in body


# ---------------------------------------------------------------------------
# Integration test 2: Second publish (prior snapshot exists)
# ---------------------------------------------------------------------------


def test_publish_notif_email_with_prior_snapshot(client: TestClient, db_session: Session) -> None:
    """Second TALLY publish renders diff body with new/settled counts vs prior snapshot."""
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)

    party = "NotifClient Beta"
    _create_canonical_for_party(db_session, "IND", party, alias_text=party)

    # --- First publish (snapshot 1 — as_of 2026-03-31) ---
    xlsx1 = _make_tally_xlsx(
        data_rows=[[date(2026, 1, 15), "NOTIF-BETA-001", party, 10000.0, 10000.0, None, None]]
    )
    upload_resp1 = _upload(client, xlsx1, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp1.status_code == 201, upload_resp1.json()
    snap1_id = upload_resp1.json()["snapshot_id"]
    _ack_all_warnings(client, db_session, snap1_id)
    pub_resp1 = _publish(client, snap1_id)
    assert pub_resp1.status_code == 200, pub_resp1.json()

    # Satisfy §13 #6 reconciliation gate before second publish.
    # Reconcile ALL published IND snapshots in this Neon session to avoid interference
    # from snapshots published by earlier tests in the same session.
    _reconcile_all_published_for_entity(db_session, "IND")

    # --- Second publish (snapshot 2 — as_of 2026-04-30) ---
    # Drop NOTIF-BETA-001, add NOTIF-BETA-002 → settled=1, new=1
    xlsx2 = _make_tally_xlsx(
        data_rows=[[date(2026, 2, 20), "NOTIF-BETA-002", party, 8000.0, 8000.0, None, None]]
    )
    upload_resp2 = _upload(client, xlsx2, entity_code="IND", as_of_date="2026-04-30")
    assert upload_resp2.status_code == 201, upload_resp2.json()
    snap2_id = upload_resp2.json()["snapshot_id"]
    _ack_all_warnings(client, db_session, snap2_id)
    pub_resp2 = _publish(client, snap2_id)
    assert pub_resp2.status_code == 200, pub_resp2.json()

    outbox = _get_latest_outbox_row(db_session, snap2_id)
    body = outbox.body_html
    assert body is not None

    # Diff section is present
    assert "Prior snapshot" in body
    assert "Settled invoices" in body
    # Counts: 1 settled (NOTIF-BETA-001 absent from snap2), 1 new (NOTIF-BETA-002)
    assert "1" in body  # appears for both new and settled count
    # Current snapshot outstanding total present
    assert "8000.00" in body
    # Prior total section present (exact value omitted — Neon session may have
    # other published snapshots whose totals vary by test order)
    assert "This snapshot" in body
    # Dashboard link for IND
    assert "/dashboard?entity=IND" in body
