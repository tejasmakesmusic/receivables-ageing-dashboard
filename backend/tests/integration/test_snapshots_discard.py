"""Integration tests for POST /snapshots/:id/discard (M3 Task 6).

Test strategy:
- Re-uses auth helpers + XLSX builders from test_snapshots_publish.py.
- Per-test DB rollback (function-scoped client + db_session fixtures).
- Covers: happy path, role negatives, already-published 409,
  already-discarded 409, audit log written, optional reason field.
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from typing import TYPE_CHECKING, Any

import openpyxl
from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth helpers (identical pattern to test_snapshots_publish.py)
# ---------------------------------------------------------------------------


def _login(client: TestClient, email: str) -> None:
    client.get(f"/auth/google/callback?stub_email={email}", follow_redirects=False)


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token", "")


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient,
    db_session: Session,
    email: str,
    entity_code: str | None = None,
) -> uuid.UUID:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    if entity_code is not None:
        entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
        assert entity is not None
        user.entity_id_scope = entity.id
    else:
        user.entity_id_scope = None
    user.is_active = True
    db_session.flush()
    return user.id


def _login_as_cfo(client: TestClient, db_session: Session, email: str) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _login_as_pending(client: TestClient, email: str) -> None:
    _login(client, email)


# ---------------------------------------------------------------------------
# XLSX builder (minimal TALLY sheet for upload)
# ---------------------------------------------------------------------------


def _make_tally_xlsx(
    data_rows: list[list[Any]] | None = None,
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
    for row in data_rows or []:
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
    csrf_token = _csrf(client)
    headers: dict[str, str] = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    return client.post(
        "/snapshots",
        data={"entity_code": entity_code, "source_hint": source_hint, "as_of_date": as_of_date},
        files={
            "file": (
                filename,
                io.BytesIO(file_bytes),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=headers,
    )


def _discard(
    client: TestClient,
    snapshot_id: str,
    reason: str | None = None,
) -> Any:
    csrf_token = _csrf(client)
    headers: dict[str, str] = {"X-CSRF-Token": csrf_token} if csrf_token else {}
    body: dict[str, Any] = {}
    if reason is not None:
        body["reason"] = reason
    return client.post(
        f"/snapshots/{snapshot_id}/discard",
        json=body,
        headers=headers,
    )


def _upload_staged(
    client: TestClient,
    entity_code: str = "IND",
    filename: str = "test.xlsx",
) -> str:
    xlsx = _make_tally_xlsx(
        data_rows=[[date(2026, 2, 1), "INV-DISC-001", "DiscardParty", 1000.0, 1000.0, None, None]]
    )
    resp = _upload(client, xlsx, entity_code=entity_code, filename=filename)
    assert resp.status_code == 201, resp.json()
    return resp.json()["snapshot_id"]


# ---------------------------------------------------------------------------
# Test 1: Happy path — ADMIN discards STAGED snapshot
# ---------------------------------------------------------------------------


def test_discard_happy_path_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client)

    resp = _discard(client, snapshot_id, reason="Test discard reason")
    assert resp.status_code == 200, resp.json()
    body = resp.json()

    assert body["status"] == "DISCARDED"
    assert body["snapshot_id"] == snapshot_id
    assert body["reason"] == "Test discard reason"
    assert body["discarded_at"] is not None
    assert body["discarded_by"]["email"] == "tejaswa.sharma@emb.global"

    # DB state
    snap = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(snapshot_id)))
    assert snap is not None
    assert snap.status == "DISCARDED"
    assert snap.discarded_at is not None
    assert snap.discarded_by is not None


# ---------------------------------------------------------------------------
# Test 2: Happy path — ANALYST (own entity) discards
# ---------------------------------------------------------------------------


def test_discard_analyst_own_entity(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst.ind@emb.global", entity_code="IND")
    snapshot_id = _upload_staged(client, entity_code="IND")

    resp = _discard(client, snapshot_id)
    assert resp.status_code == 200, resp.json()
    assert resp.json()["status"] == "DISCARDED"


# ---------------------------------------------------------------------------
# Test 3: Optional reason — None when omitted
# ---------------------------------------------------------------------------


def test_discard_no_reason_returns_none(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, filename="no_reason.xlsx")

    resp = _discard(client, snapshot_id)
    assert resp.status_code == 200
    assert resp.json()["reason"] is None


# ---------------------------------------------------------------------------
# Test 4: RBAC — CFO → 403
# ---------------------------------------------------------------------------


def test_discard_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, filename="cfo_test.xlsx")

    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = _discard(client, snapshot_id)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 5: RBAC — PENDING → 403
# ---------------------------------------------------------------------------


def test_discard_pending_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, filename="pending_test.xlsx")

    _login_as_pending(client, "pending@emb.global")
    resp = _discard(client, snapshot_id)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 6: RBAC — ANALYST wrong entity → 403
# ---------------------------------------------------------------------------


def test_discard_analyst_wrong_entity_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, entity_code="IND", filename="wrong_entity.xlsx")

    # Analyst scoped to UAE — cannot discard IND snapshot
    _login_as_analyst(client, db_session, "analyst.uae2@emb.global", entity_code="UAE")
    resp = _discard(client, snapshot_id)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 7: Already-published snapshot → 409
# ---------------------------------------------------------------------------


def test_discard_already_published_returns_409(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, filename="pub_disc.xlsx")

    # Force publish status directly
    snap = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(snapshot_id)))
    assert snap is not None
    snap.status = "PUBLISHED"
    db_session.flush()

    resp = _discard(client, snapshot_id)
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["code"] == "SNAPSHOT_NOT_STAGED"
    assert detail["snapshot_status"] == "PUBLISHED"


# ---------------------------------------------------------------------------
# Test 8: Already-discarded snapshot → 409
# ---------------------------------------------------------------------------


def test_discard_already_discarded_returns_409(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, filename="disc_twice.xlsx")

    # First discard — should succeed
    resp1 = _discard(client, snapshot_id, reason="First discard")
    assert resp1.status_code == 200

    # Second discard — 409
    resp2 = _discard(client, snapshot_id, reason="Second discard")
    assert resp2.status_code == 409
    detail = resp2.json()["detail"]
    assert detail["code"] == "SNAPSHOT_NOT_STAGED"
    assert detail["snapshot_status"] == "DISCARDED"


# ---------------------------------------------------------------------------
# Test 9: Audit log written on discard
# ---------------------------------------------------------------------------


def test_discard_audit_log_written(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    snapshot_id = _upload_staged(client, filename="audit_test.xlsx")

    resp = _discard(client, snapshot_id, reason="Audit test reason")
    assert resp.status_code == 200

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "snapshot.discard",
            AuditLog.entity_id == uuid.UUID(snapshot_id),
        )
    )
    assert audit is not None
    assert audit.before == {"status": "STAGED"}
    assert audit.after["status"] == "DISCARDED"
    assert audit.after["reason"] == "Audit test reason"
    assert "discarded_by" in audit.after
