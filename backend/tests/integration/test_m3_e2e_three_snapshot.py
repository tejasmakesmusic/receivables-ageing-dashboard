"""Comprehensive 3-snapshot end-to-end test (M3 Task 7 — Deliverable B).

Extends spec §12 "E2E: full flow from upload → staging → publish" with:
- Material-change flag on snapshot 2 (amount +10% on invoice with ACTIVE tag)
- Exception auto-resolve cascade on snapshot 3 (missing invoice → SETTLED → AUTO_RESOLVED)
- PUBLISH_NOTIF rows in email_outbox (one per snapshot, total 3)
- Audit log progression (upload + publish entries per snapshot, actor attribution)
- invoice_snapshots partition routing (2026-Q1 and 2026-Q2)
- Published snapshot cannot be re-discarded → 409

Note: ExceptionBucketType and ExceptionTag rows are seeded directly via
db_session because the exception-tag creation API is M5 scope.

Relations between the existing test in test_snapshots_publish.py:
- test_three_snapshot_upsert_insert_update_settle: basic insert→update→settle.
- test_exception_auto_resolved_on_settled_cascade: auto-resolve only.
- test_material_change_flagged_when_amount_delta_gt_5_percent_on_active_exception: material-change only.

This test combines all of the above assertions into one sequential flow
plus adds email_outbox, audit_log, partition routing, and state-machine
negative (discard after publish → 409).
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

import openpyxl
import pytest
from sqlalchemy import select, text

from app.db.models.audit_log import AuditLog
from app.db.models.email_outbox import EmailOutbox
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
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
# Reconciliation helper (satisfies §13 #6 gate between publishes)
# ---------------------------------------------------------------------------


def _reconcile_snapshot_directly(
    db_session: Session,
    snapshot_id: str,
) -> None:
    """Insert a MATCHED ReconciliationEntry row directly via db_session.

    Satisfies the §13 #6 gate that blocks the next publish until the prior
    published snapshot is MATCHED.  We bypass the HTTP API here to avoid
    per-test session re-login overhead.

    delta=0 → abs(delta)=0 ≤ ₹100 tolerance → MATCHED.
    """
    from decimal import Decimal

    from sqlalchemy import select

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
        existing.notes = "test-helper auto-reconcile"
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


# ---------------------------------------------------------------------------
# Auth + request helpers
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _csrf_headers(client: TestClient) -> dict[str, str]:
    tok = _csrf(client)
    return {"X-CSRF-Token": tok} if tok else {}


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


# ---------------------------------------------------------------------------
# XLSX builders (Tally format used throughout)
# ---------------------------------------------------------------------------


def _make_tally_xlsx(data_rows: list[list[Any]]) -> bytes:
    """Build a Tally XLSX with the given invoice data_rows.

    Each element of data_rows: [inv_date, ref_no, party_name, opening, pending, due_on, overdue]
    The Tally parser requires a party header row before each invoice block.
    """
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
    for row in data_rows:
        inv_date, ref_no, party_name, opening, pending, due_on, overdue = row
        if party_name is not None:
            ws.append([None, None, party_name, None, None, None, None])
        ws.append([inv_date, ref_no, None, opening, pending, due_on, overdue])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# DB setup helpers
# ---------------------------------------------------------------------------


def _get_admin(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert user is not None
    return user


def _get_entity(db_session: Session, entity_code: str) -> Entity:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    return entity


def _set_entity_default_credit_days(db_session: Session, entity_code: str, days: int) -> None:
    entity = _get_entity(db_session, entity_code)
    entity.default_credit_days = days
    db_session.flush()


def _create_canonical_with_alias(
    db_session: Session,
    entity_code: str,
    canonical_name: str,
    alias_text: str,
) -> uuid.UUID:
    """Create a canonical party + exact-match alias. Returns canonical_id."""
    admin = _get_admin(db_session)
    entity = _get_entity(db_session, entity_code)
    canonical = PartyCanonical(entity_id=entity.id, name=canonical_name, created_by=admin.id)
    db_session.add(canonical)
    db_session.flush()

    alias = PartyAlias(
        canonical_id=canonical.id,
        alias_text=alias_text,
        source="MANUAL",
        confidence=None,
        created_by=admin.id,
    )
    db_session.add(alias)
    db_session.flush()
    return cast(uuid.UUID, canonical.id)


def _add_exception_tag(
    db_session: Session,
    invoice_id: uuid.UUID,
    reason: str = "E2E test exception",
) -> ExceptionTag:
    """Insert an ACTIVE ExceptionTag on an invoice directly via DB session.

    Note: Exception-tag creation API is M5 scope. This test uses direct DB
    insertion to set up the precondition without depending on M5 routes.
    """
    admin = _get_admin(db_session)
    bucket_type = db_session.scalar(select(ExceptionBucketType).limit(1))
    assert (
        bucket_type is not None
    ), "No ExceptionBucketType seeded — migration 0006 should seed at least one"
    tag = ExceptionTag(
        invoice_id=invoice_id,
        bucket_type_id=bucket_type.id,
        reason=reason,
        tagged_by=admin.id,
        status="ACTIVE",
    )
    db_session.add(tag)
    db_session.flush()
    return tag


# ---------------------------------------------------------------------------
# Upload + staging workflow helpers
# ---------------------------------------------------------------------------


def _upload(
    client: TestClient,
    file_bytes: bytes,
    entity_code: str,
    source_hint: str,
    as_of_date: str,
    filename: str,
) -> Any:
    csrf_tok = _csrf(client)
    headers = {"X-CSRF-Token": csrf_tok} if csrf_tok else {}
    return client.post(
        "/snapshots",
        data={
            "entity_code": entity_code,
            "source_hint": source_hint,
            "as_of_date": as_of_date,
        },
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
    resp = client.patch(
        f"/snapshots/{snapshot_id}/warnings/ack",
        json={"codes": codes},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, f"ack_warnings failed: {resp.json()}"


def _publish(client: TestClient, snapshot_id: str) -> Any:
    return client.post(
        f"/snapshots/{snapshot_id}/publish",
        json={},
        headers=_csrf_headers(client),
    )


def _discard(client: TestClient, snapshot_id: str) -> Any:
    return client.post(
        f"/snapshots/{snapshot_id}/discard",
        json={},
        headers=_csrf_headers(client),
    )


# ---------------------------------------------------------------------------
# The comprehensive 3-snapshot E2E test
# ---------------------------------------------------------------------------


def test_comprehensive_three_snapshot_e2e(  # noqa: PLR0915
    client: TestClient, db_session: Session
) -> None:
    """Full E2E: upload→stage→publish × 3 snapshots.

    Assertions per snapshot:
    - Snapshot 1 (2026-Q1): 3 invoices inserted. ACTIVE exception tag added to INV-E2E-A.
      Audit log has upload + publish entries. PUBLISH_NOTIF in email_outbox.
    - Snapshot 2 (2026-Q1 still): INV-E2E-A amount +10% → material_change_flags_json.
      INV-E2E-C absent → SETTLED with settled_snapshot_id = s2.
      invoice_snapshots written to 2026-Q1 partition.
    - Snapshot 3 (2026-Q2): INV-E2E-A absent → SETTLED → exception tag AUTO_RESOLVED.
      invoice_snapshots written to 2026-Q2 partition.
      email_outbox total = 3. audit_log has upload+publish for all 3.
    - Discard snapshot 2 (already PUBLISHED) → 409.
    """
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)

    party = "E2EComprehensiveParty"
    _create_canonical_with_alias(db_session, "IND", party, party)

    # =========================================================================
    # SNAPSHOT 1: 2026-02-28 (Q1 partition) — 3 invoices inserted
    # =========================================================================

    xlsx1 = _make_tally_xlsx(
        data_rows=[
            [date(2026, 1, 1), "INV-E2E-A", party, 1000.0, 1000.0, None, None],
            [date(2026, 1, 2), "INV-E2E-B", party, 2000.0, 2000.0, None, None],
            [date(2026, 1, 3), "INV-E2E-C", party, 3000.0, 3000.0, None, None],
        ]
    )
    r1 = _upload(client, xlsx1, "IND", "TALLY", "2026-02-28", "e2e_snap1.xlsx")
    assert r1.status_code == 201, r1.json()
    s1_id = r1.json()["snapshot_id"]

    # Audit: upload row created
    audit_upload_s1 = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "snapshot.upload",
            AuditLog.entity_id == uuid.UUID(s1_id),
        )
    )
    assert audit_upload_s1 is not None, "snapshot.upload audit missing after s1 upload"
    assert audit_upload_s1.after["source_hint"] == "TALLY"

    _ack_all_warnings(client, db_session, s1_id)
    pub1 = _publish(client, s1_id)
    assert pub1.status_code == 200, pub1.json()
    r1_result = pub1.json()["result"]
    assert r1_result["invoices_inserted"] == 3
    assert r1_result["invoices_updated"] == 0
    assert r1_result["invoices_settled"] == 0
    assert r1_result["invoice_snapshots_written"] == 3

    # Satisfy §13 #6 gate before snapshot 2
    _reconcile_snapshot_directly(db_session, s1_id)

    # Audit: publish row created for s1
    audit_pub_s1 = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "snapshot.publish",
            AuditLog.entity_id == uuid.UUID(s1_id),
        )
    )
    assert audit_pub_s1 is not None, "snapshot.publish audit missing after s1 publish"
    assert audit_pub_s1.before == {"status": "STAGED"}
    assert audit_pub_s1.after["status"] == "PUBLISHED"
    assert audit_pub_s1.after["result"]["invoices_inserted"] == 3
    admin_user = _get_admin(db_session)
    assert audit_pub_s1.actor_user_id == admin_user.id, "Actor attribution mismatch on s1 publish"

    # email_outbox: PUBLISH_NOTIF row for s1
    outbox_s1 = db_session.scalar(
        select(EmailOutbox).where(
            EmailOutbox.snapshot_id == uuid.UUID(s1_id),
            EmailOutbox.rule_type == "PUBLISH_NOTIF",
        )
    )
    assert outbox_s1 is not None, "PUBLISH_NOTIF missing from email_outbox for s1"
    assert outbox_s1.status == "QUEUED"

    # DB: verify invoices exist + invoice_snapshots in Q1 partition (as_of_date=2026-02-28)
    inv_a = db_session.scalar(select(Invoice).where(Invoice.invoice_ref == "INV-E2E-A"))
    inv_b = db_session.scalar(select(Invoice).where(Invoice.invoice_ref == "INV-E2E-B"))
    inv_c = db_session.scalar(select(Invoice).where(Invoice.invoice_ref == "INV-E2E-C"))
    assert inv_a is not None and inv_b is not None and inv_c is not None

    # Verify invoice_snapshots in Q1 partition (2026-02-28 ∈ [2026-01-01, 2026-04-01))
    q1_count = db_session.scalar(
        text("SELECT COUNT(*) FROM invoice_snapshots_2026_q1 " "WHERE snapshot_id = :sid"),
        {"sid": str(s1_id)},
    )
    assert q1_count == 3, f"Expected 3 rows in Q1 partition for s1, got {q1_count}"

    # Add ACTIVE exception tag on INV-E2E-A (direct DB — M5 API not yet shipped)
    tag_a = _add_exception_tag(db_session, inv_a.id, reason="E2E: active exception on INV-E2E-A")

    # =========================================================================
    # SNAPSHOT 2: 2026-03-31 (Q1) — INV-E2E-A amount +10%, INV-E2E-B same,
    #             INV-E2E-C absent → SETTLED; material-change flag on INV-E2E-A
    # =========================================================================

    xlsx2 = _make_tally_xlsx(
        data_rows=[
            [date(2026, 1, 1), "INV-E2E-A", party, 1100.0, 1100.0, None, None],  # +10%
            [date(2026, 1, 2), "INV-E2E-B", party, 2000.0, 2000.0, None, None],  # unchanged
        ]
    )
    r2 = _upload(client, xlsx2, "IND", "TALLY", "2026-03-31", "e2e_snap2.xlsx")
    assert r2.status_code == 201, r2.json()
    s2_id = r2.json()["snapshot_id"]

    _ack_all_warnings(client, db_session, s2_id)
    pub2 = _publish(client, s2_id)
    assert pub2.status_code == 200, pub2.json()
    r2_result = pub2.json()["result"]

    # Satisfy §13 #6 gate before snapshot 3
    _reconcile_snapshot_directly(db_session, s2_id)

    # INV-E2E-C settled (absent from snapshot 2)
    assert r2_result["invoices_settled"] == 1
    # Material-change flag set (INV-E2E-A has ACTIVE tag, delta = 10% > 5%)
    assert r2_result["exceptions_material_change_flagged"] == 1

    db_session.expire_all()
    inv_c_s2 = db_session.scalar(select(Invoice).where(Invoice.invoice_ref == "INV-E2E-C"))
    assert inv_c_s2 is not None
    assert inv_c_s2.status == "SETTLED"
    assert inv_c_s2.settled_snapshot_id == uuid.UUID(s2_id)

    # INV-E2E-A amount updated
    inv_a_s2 = db_session.scalar(select(Invoice).where(Invoice.invoice_ref == "INV-E2E-A"))
    assert inv_a_s2 is not None
    assert inv_a_s2.amount == Decimal("1100.00")

    # Material-change flag stored on snapshot 2
    snap2 = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(s2_id)))
    assert snap2 is not None
    flags = snap2.material_change_flags_json
    assert len(flags) >= 1, "Expected at least one material-change flag on s2"
    flag_invoice_ids = [f["invoice_id"] for f in flags]
    assert str(inv_a.id) in flag_invoice_ids, "Material-change flag must reference INV-E2E-A"
    # Find our flag and check delta_pct > 5
    a_flag = next(f for f in flags if f["invoice_id"] == str(inv_a.id))
    assert Decimal(str(a_flag["delta_pct"])) > Decimal(
        "5"
    ), f"Expected delta_pct > 5, got {a_flag['delta_pct']}"

    # Tag on INV-E2E-A still ACTIVE (material-change doesn't auto-resolve)
    db_session.expire(tag_a)
    db_session.refresh(tag_a)
    assert tag_a.status == "ACTIVE", "Tag should remain ACTIVE after material-change flag"

    # email_outbox: second PUBLISH_NOTIF for s2
    outbox_s2 = db_session.scalar(
        select(EmailOutbox).where(
            EmailOutbox.snapshot_id == uuid.UUID(s2_id),
            EmailOutbox.rule_type == "PUBLISH_NOTIF",
        )
    )
    assert outbox_s2 is not None, "PUBLISH_NOTIF missing for s2"

    # Audit: upload + publish for s2
    audit_pub_s2 = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "snapshot.publish",
            AuditLog.entity_id == uuid.UUID(s2_id),
        )
    )
    assert audit_pub_s2 is not None
    assert audit_pub_s2.actor_user_id == admin_user.id

    # invoice_snapshots for s2 in Q1 partition (2026-03-31 ∈ [2026-01-01, 2026-04-01))
    q1_count_s2 = db_session.scalar(
        text("SELECT COUNT(*) FROM invoice_snapshots_2026_q1 " "WHERE snapshot_id = :sid"),
        {"sid": str(s2_id)},
    )
    # s2 has INV-E2E-A and INV-E2E-B (INV-E2E-C settled → no invoice_snapshot row)
    assert q1_count_s2 == 2, f"Expected 2 rows in Q1 partition for s2, got {q1_count_s2}"

    # =========================================================================
    # SNAPSHOT 3: 2026-04-30 (Q2) — INV-E2E-A absent → SETTLED → tag AUTO_RESOLVED
    #             Only INV-E2E-B remains
    # =========================================================================

    xlsx3 = _make_tally_xlsx(
        data_rows=[
            [date(2026, 1, 2), "INV-E2E-B", party, 2000.0, 2000.0, None, None],
        ]
    )
    r3 = _upload(client, xlsx3, "IND", "TALLY", "2026-04-30", "e2e_snap3.xlsx")
    assert r3.status_code == 201, r3.json()
    s3_id = r3.json()["snapshot_id"]

    _ack_all_warnings(client, db_session, s3_id)
    pub3 = _publish(client, s3_id)
    assert pub3.status_code == 200, pub3.json()
    r3_result = pub3.json()["result"]

    # INV-E2E-A settled in s3
    assert r3_result["invoices_settled"] == 1
    # Exception on INV-E2E-A should be auto-resolved
    assert r3_result["exceptions_auto_resolved"] == 1

    db_session.expire_all()
    inv_a_s3 = db_session.scalar(select(Invoice).where(Invoice.invoice_ref == "INV-E2E-A"))
    assert inv_a_s3 is not None
    assert inv_a_s3.status == "SETTLED"
    assert inv_a_s3.settled_snapshot_id == uuid.UUID(s3_id)

    # Exception tag on INV-E2E-A → AUTO_RESOLVED
    db_session.refresh(tag_a)
    assert tag_a.status == "AUTO_RESOLVED", f"Expected AUTO_RESOLVED, got {tag_a.status}"
    assert tag_a.resolved_at is not None
    assert tag_a.resolution_note is not None
    assert (
        "settled" in tag_a.resolution_note.lower()
    ), f"resolution_note should mention 'settled', got: {tag_a.resolution_note!r}"

    # Only INV-E2E-B got an invoice_snapshot in s3 (settled invoice excluded)
    assert r3_result["invoice_snapshots_written"] == 1

    # invoice_snapshots for s3 in Q2 partition (2026-04-30 ∈ [2026-04-01, 2026-07-01))
    q2_count_s3 = db_session.scalar(
        text("SELECT COUNT(*) FROM invoice_snapshots_2026_q2 " "WHERE snapshot_id = :sid"),
        {"sid": str(s3_id)},
    )
    assert q2_count_s3 == 1, f"Expected 1 row in Q2 partition for s3, got {q2_count_s3}"

    # Verify INV-E2E-A has NO invoice_snapshot row in s3 (settled → excluded)
    snap_row_for_a_in_s3 = (
        db_session.query(InvoiceSnapshot)
        .filter(
            InvoiceSnapshot.invoice_id == inv_a.id,
            InvoiceSnapshot.snapshot_id == uuid.UUID(s3_id),
        )
        .count()
    )
    assert snap_row_for_a_in_s3 == 0, "Settled invoice must NOT get invoice_snapshot row in s3"

    # =========================================================================
    # Cross-snapshot assertions
    # =========================================================================

    # email_outbox: total 3 PUBLISH_NOTIF rows (one per snapshot)
    outbox_s3 = db_session.scalar(
        select(EmailOutbox).where(
            EmailOutbox.snapshot_id == uuid.UUID(s3_id),
            EmailOutbox.rule_type == "PUBLISH_NOTIF",
        )
    )
    assert outbox_s3 is not None, "PUBLISH_NOTIF missing for s3"

    total_notifs = (
        db_session.query(EmailOutbox)
        .filter(
            EmailOutbox.snapshot_id.in_([uuid.UUID(s1_id), uuid.UUID(s2_id), uuid.UUID(s3_id)]),
            EmailOutbox.rule_type == "PUBLISH_NOTIF",
        )
        .count()
    )
    assert total_notifs == 3, f"Expected 3 PUBLISH_NOTIF rows total, got {total_notifs}"

    # Audit log: 6 entries total (upload + publish for each of 3 snapshots)
    for sid, label in [(s1_id, "s1"), (s2_id, "s2"), (s3_id, "s3")]:
        for action in ("snapshot.upload", "snapshot.publish"):
            row = db_session.scalar(
                select(AuditLog).where(
                    AuditLog.action == action,
                    AuditLog.entity_id == uuid.UUID(sid),
                )
            )
            assert row is not None, f"Missing audit row: {action} for {label} ({sid})"
            assert (
                row.actor_user_id == admin_user.id
            ), f"Actor mismatch on {action} for {label}: {row.actor_user_id}"

    # =========================================================================
    # State-machine negative: discard s2 (PUBLISHED) → 409
    # =========================================================================

    discard_resp = _discard(client, s2_id)
    assert discard_resp.status_code == 409, (
        f"Expected 409 when discarding a PUBLISHED snapshot, "
        f"got {discard_resp.status_code}: {discard_resp.text}"
    )
    detail = discard_resp.json().get("detail", {})
    code = detail.get("code", "") if isinstance(detail, dict) else str(detail)
    assert code in (
        "SNAPSHOT_NOT_STAGED",
        "CANNOT_DISCARD_PUBLISHED",
    ), f"Expected SNAPSHOT_NOT_STAGED or CANNOT_DISCARD_PUBLISHED error code, got {code!r}"


# ---------------------------------------------------------------------------
# Supplementary: partition routing per as_of_date boundary
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("as_of_date", "partition_table", "ref"),
    [
        ("2026-01-31", "invoice_snapshots_2026_q1", "INV-PART-Q1-JAN"),
        ("2026-03-31", "invoice_snapshots_2026_q1", "INV-PART-Q1-MAR"),
        ("2026-04-01", "invoice_snapshots_2026_q2", "INV-PART-Q2-APR"),
        ("2026-06-30", "invoice_snapshots_2026_q2", "INV-PART-Q2-JUN"),
    ],
)
def test_invoice_snapshot_partition_routing(
    client: TestClient,
    db_session: Session,
    as_of_date: str,
    partition_table: str,
    ref: str,
) -> None:
    """invoice_snapshots rows land in the correct partition based on as_of_date."""
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)

    party = f"PartitionParty_{ref}"
    _create_canonical_with_alias(db_session, "IND", party, party)

    xlsx = _make_tally_xlsx(data_rows=[[date(2026, 1, 1), ref, party, 500.0, 500.0, None, None]])
    r = _upload(client, xlsx, "IND", "TALLY", as_of_date, filename=f"partition_{ref}.xlsx")
    assert r.status_code == 201, r.json()
    snapshot_id = r.json()["snapshot_id"]

    snap = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(snapshot_id)))
    assert snap is not None
    pr = snap.parse_result_json or {}
    codes = sorted({w.get("code") for w in pr.get("warnings", []) if w.get("code")})
    if codes:
        client.patch(
            f"/snapshots/{snapshot_id}/warnings/ack",
            json={"codes": codes},
            headers=_csrf_headers(client),
        )

    pub = _publish(client, snapshot_id)
    assert pub.status_code == 200, pub.json()

    count = db_session.scalar(
        text(f"SELECT COUNT(*) FROM {partition_table} WHERE snapshot_id = :sid"),
        {"sid": str(snapshot_id)},
    )
    assert count == 1, f"{ref} @ {as_of_date}: expected 1 row in {partition_table}, got {count}"
