"""Integration tests for the prior-snapshot reconciliation publish gate (M6 Group H).

Spec §13 #6: Before publishing snapshot N, the most recent prior PUBLISHED snapshot
for the same entity must have status=MATCHED in reconciliation_entries. If it is
UNRECONCILED or MISMATCHED the publish must fail with 422 PRIOR_SNAPSHOT_UNRECONCILED.

Two cases pass:
  1. No prior published snapshot exists → allow publish.
  2. Prior snapshot has reconciliation status=MATCHED → allow publish.

Two cases block:
  3. Prior snapshot has no reconciliation entry (UNRECONCILED) → 422.
  4. Prior snapshot has status=MISMATCHED → 422.
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

import openpyxl
from sqlalchemy import select

from app.db.models.entity import Entity
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.reconciliation_entry import ReconciliationEntry
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth & CSRF helpers
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


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


def _build_published_snapshot_with_invoice(
    db_session: Session,
    as_of_date: date,
    entity_code: str = "IND",
    ref_suffix: str = "A",
) -> uuid.UUID:
    """Minimal PUBLISHED snapshot with one OPEN invoice + invoice_snapshot row."""
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)

    canonical = PartyCanonical(
        entity_id=entity_id,
        name=f"GateParty-{ref_suffix}",
        created_by=admin,
    )
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
        invoice_ref=f"GATE-{ref_suffix}-INV",
        invoice_date=date(2026, 1, 15),
        amount=Decimal("10000"),
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
        outstanding_amount=Decimal("10000"),
        overdue_days=0,
        bucket="NOT_DUE",
    )
    db_session.add(inv_snap)
    db_session.flush()
    return cast(uuid.UUID, snapshot.id)


def _add_reconciliation_entry(
    db_session: Session,
    snapshot_id: uuid.UUID,
    status: str,
) -> None:
    admin = _admin_id(db_session)
    delta = Decimal("0") if status == "MATCHED" else Decimal("5000")
    entry = ReconciliationEntry(
        snapshot_id=snapshot_id,
        dashboard_ar=Decimal("10000"),
        exception_bucket_total=Decimal("0"),
        exception_bucket_breakdown={},
        tally_xero_closing_ar=Decimal("10000") if status == "MATCHED" else Decimal("5000"),
        delta=delta,
        status=status,
        entered_by=admin,
    )
    db_session.add(entry)
    db_session.flush()


# ---------------------------------------------------------------------------
# Upload helpers (from snapshot publish test pattern)
# ---------------------------------------------------------------------------


def _make_tally_xlsx(
    party_name: str = "GateClient",
    inv_date: date = date(2026, 2, 1),
    inv_ref: str = "GATE-INV-001",
    amount: float = 5000.0,
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
    ws = wb.create_sheet("Sundry Debtors")
    for row in _meta:
        ws.append(row)
    ws.append([None, None, party_name, None, None, None, None])
    ws.append([inv_date, inv_ref, None, amount, amount, None, None])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(
    client: TestClient,
    file_bytes: bytes,
    entity_code: str = "IND",
    as_of_date: str = "2026-04-30",
) -> Any:
    data: dict[str, Any] = {
        "entity_code": entity_code,
        "source_hint": "TALLY",
        "as_of_date": as_of_date,
    }
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    return client.post(
        "/snapshots",
        data=data,
        files={
            "file": (
                "test.xlsx",
                io.BytesIO(file_bytes),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=headers,
    )


def _create_canonical_and_alias(
    db_session: Session,
    entity_code: str,
    party_name: str,
) -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    canonical = PartyCanonical(entity_id=entity_id, name=party_name, created_by=admin)
    db_session.add(canonical)
    db_session.flush()
    alias = PartyAlias(
        canonical_id=canonical.id,
        alias_text=party_name,
        source="MANUAL",
        confidence=None,
        created_by=admin,
    )
    db_session.add(alias)
    db_session.flush()
    return cast(uuid.UUID, canonical.id)


def _ack_warnings(client: TestClient, db_session: Session, snapshot_id: str) -> None:
    snap = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(snapshot_id)))
    if not snap:
        return
    pr = snap.parse_result_json or {}
    codes = sorted({w.get("code") for w in pr.get("warnings", []) if w.get("code")})
    if not codes:
        return
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.patch(
        f"/snapshots/{snapshot_id}/warnings/ack",
        json={"codes": codes},
        headers=headers,
    )
    assert resp.status_code == 200, resp.json()


def _set_entity_credit_days(db_session: Session, entity_code: str, days: int) -> None:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    entity.default_credit_days = days
    db_session.flush()


# ---------------------------------------------------------------------------
# Gate tests — direct DB manipulation for prior snapshot
# ---------------------------------------------------------------------------


def test_gate_passes_when_no_prior_published_snapshot(
    client: TestClient, db_session: Session
) -> None:
    """First snapshot for an entity has no prior → publish must succeed."""
    _login_as_admin(client)
    _set_entity_credit_days(db_session, "IND", 30)
    party_name = "FirstGateParty"
    _create_canonical_and_alias(db_session, "IND", party_name)
    xlsx = _make_tally_xlsx(
        party_name=party_name,
        inv_ref="GATE-FIRST-001",
    )
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snap_id = upload_resp.json()["snapshot_id"]

    _ack_warnings(client, db_session, snap_id)

    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.post(f"/snapshots/{snap_id}/publish", json={}, headers=headers)
    assert resp.status_code == 200, resp.json()


def test_gate_passes_when_prior_is_matched(
    client: TestClient, db_session: Session
) -> None:
    """Prior snapshot exists with MATCHED reconciliation → allow new publish."""
    _login_as_admin(client)

    # Build prior PUBLISHED snapshot with MATCHED reconciliation directly in DB
    prior_id = _build_published_snapshot_with_invoice(
        db_session, as_of_date=date(2026, 2, 28), ref_suffix="GATE-PRIOR"
    )
    _add_reconciliation_entry(db_session, prior_id, "MATCHED")

    # Now upload + publish a later snapshot via API
    _set_entity_credit_days(db_session, "IND", 30)
    party_name = "GateMatchedParty"
    _create_canonical_and_alias(db_session, "IND", party_name)
    xlsx = _make_tally_xlsx(
        party_name=party_name,
        inv_ref="GATE-MATCHED-001",
    )
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snap_id = upload_resp.json()["snapshot_id"]

    _ack_warnings(client, db_session, snap_id)
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.post(f"/snapshots/{snap_id}/publish", json={}, headers=headers)
    assert resp.status_code == 200, resp.json()


def test_gate_blocks_when_prior_is_unreconciled(
    client: TestClient, db_session: Session
) -> None:
    """Prior snapshot exists but has NO reconciliation entry → 422."""
    _login_as_admin(client)

    # Build prior PUBLISHED snapshot with NO reconciliation entry
    _build_published_snapshot_with_invoice(
        db_session, as_of_date=date(2026, 2, 28), ref_suffix="GATE-UNRECON"
    )

    _set_entity_credit_days(db_session, "IND", 30)
    party_name = "GateUnreconParty"
    _create_canonical_and_alias(db_session, "IND", party_name)
    xlsx = _make_tally_xlsx(
        party_name=party_name,
        inv_ref="GATE-UNRECON-001",
    )
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snap_id = upload_resp.json()["snapshot_id"]

    _ack_warnings(client, db_session, snap_id)
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.post(f"/snapshots/{snap_id}/publish", json={}, headers=headers)
    assert resp.status_code == 422, resp.json()
    assert resp.json()["detail"]["code"] == "PRIOR_SNAPSHOT_UNRECONCILED"
    assert resp.json()["detail"]["prior_status"] == "UNRECONCILED"


def test_gate_blocks_when_prior_is_mismatched(
    client: TestClient, db_session: Session
) -> None:
    """Prior snapshot has MISMATCHED reconciliation → 422."""
    _login_as_admin(client)

    prior_id = _build_published_snapshot_with_invoice(
        db_session, as_of_date=date(2026, 2, 28), ref_suffix="GATE-MISMATCH"
    )
    _add_reconciliation_entry(db_session, prior_id, "MISMATCHED")

    _set_entity_credit_days(db_session, "IND", 30)
    party_name = "GateMismatchedParty"
    _create_canonical_and_alias(db_session, "IND", party_name)
    xlsx = _make_tally_xlsx(
        party_name=party_name,
        inv_ref="GATE-MISMATCH-001",
    )
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snap_id = upload_resp.json()["snapshot_id"]

    _ack_warnings(client, db_session, snap_id)
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.post(f"/snapshots/{snap_id}/publish", json={}, headers=headers)
    assert resp.status_code == 422, resp.json()
    assert resp.json()["detail"]["code"] == "PRIOR_SNAPSHOT_UNRECONCILED"
    assert resp.json()["detail"]["prior_status"] == "MISMATCHED"


def test_gate_error_body_contains_prior_snapshot_id(
    client: TestClient, db_session: Session
) -> None:
    """422 response body must include prior_snapshot_id and prior_snapshot_as_of_date."""
    _login_as_admin(client)

    prior_id = _build_published_snapshot_with_invoice(
        db_session, as_of_date=date(2026, 2, 28), ref_suffix="GATE-BODY"
    )
    # No reconciliation entry → UNRECONCILED

    _set_entity_credit_days(db_session, "IND", 30)
    party_name = "GateBodyParty"
    _create_canonical_and_alias(db_session, "IND", party_name)
    xlsx = _make_tally_xlsx(party_name=party_name, inv_ref="GATE-BODY-001")
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snap_id = upload_resp.json()["snapshot_id"]

    _ack_warnings(client, db_session, snap_id)
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.post(f"/snapshots/{snap_id}/publish", json={}, headers=headers)
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert str(prior_id) == detail["prior_snapshot_id"]
    assert "2026-02-28" in detail["prior_snapshot_as_of_date"]


def test_gate_skips_credit_period_prior_snapshot(
    client: TestClient, db_session: Session
) -> None:
    """A CREDIT_PERIOD snapshot must not be picked as "prior" by the §13 #6 gate.

    Scenario: TALLY @ D1 (MATCHED) -> CP @ D2 (no recon, as expected) ->
    new TALLY @ D3 should publish cleanly. Without the source_hint filter
    on the prior-lookup, the CP snapshot gets chosen, has no reconciliation
    entry, and the publish 422s with PRIOR_SNAPSHOT_UNRECONCILED even though
    the real prior invoice snapshot was MATCHED.
    """
    _login_as_admin(client)

    # Prior TALLY @ D1, MATCHED
    prior_id = _build_published_snapshot_with_invoice(
        db_session, as_of_date=date(2026, 2, 28), ref_suffix="CP-GATE-PRIOR"
    )
    _add_reconciliation_entry(db_session, prior_id, "MATCHED")

    # CP @ D2 — between prior TALLY and new TALLY. No ReconciliationEntry (by design).
    cp_snap = Snapshot(
        entity_id=_entity_id(db_session, "IND"),
        as_of_date=date(2026, 3, 15),
        status="PUBLISHED",
        source_hint="CREDIT_PERIOD",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=_admin_id(db_session),
    )
    db_session.add(cp_snap)
    db_session.flush()

    # New TALLY @ D3 via the API — gate must look past CP and see MATCHED prior.
    _set_entity_credit_days(db_session, "IND", 30)
    party_name = "CPGateParty"
    _create_canonical_and_alias(db_session, "IND", party_name)
    xlsx = _make_tally_xlsx(party_name=party_name, inv_ref="CP-GATE-001")
    upload_resp = _upload(client, xlsx, entity_code="IND", as_of_date="2026-03-31")
    assert upload_resp.status_code == 201, upload_resp.json()
    snap_id = upload_resp.json()["snapshot_id"]

    _ack_warnings(client, db_session, snap_id)
    csrf_token = _csrf(client)
    headers = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    resp = client.post(f"/snapshots/{snap_id}/publish", json={}, headers=headers)
    assert resp.status_code == 200, resp.json()
