"""M7 RBAC hardening — negative-test gap fill.

Covers the mutating endpoints that were missing PENDING/CFO/cross-entity
negative tests after the M1-M6 audit.  Every test is self-contained
(uses per-test transaction rollback from conftest.py).

Endpoints covered here:
  POST   /snapshots/{id}/staging/bulk-create-canonicals
           → CFO 403, PENDING 403, ANALYST cross-entity 403
  POST   /admin/users/{id}/approve
           → ANALYST 403, CFO 403
  POST   /admin/users/{id}/deactivate
           → ANALYST 403, CFO 403
  POST   /admin/users/{id}/reactivate
           → ANALYST 403, CFO 403
  POST   /admin/email-outbox/{id}/mark-sent
           → PENDING 403  (CFO + analyst already in test_admin_email_outbox.py)
  POST   /admin/exception-buckets
           → PENDING 403  (CFO + analyst already in test_admin_exception_buckets.py)
  PATCH  /admin/exception-buckets/{id}
           → CFO 403, PENDING 403
           (analyst already in test_admin_exception_buckets.py)
  POST   /config/fx-rates
           → PENDING 403  (CFO + analyst already in test_fx_rates_crud.py)
  POST   /invoices/{id}/exceptions
           → PENDING 403  (CFO + analyst cross-entity already in test_exceptions_crud.py)
  PATCH  /exceptions/{id}
           → PENDING 403  (CFO already in test_exceptions_crud.py)

Skipped (already fully covered per audit):
  - /snapshots/* (upload, discard, staging PATCH, warnings/ack, publish):
      PENDING + CFO + cross-entity in test_m3_rbac_matrix.py
  - /config/credit-period (all verbs): test_m3_rbac_matrix.py
  - /config/aliases (all verbs): test_m3_rbac_matrix.py
  - /follow-ups (all verbs): test_follow_ups.py
  - /snapshots/{id}/reconciliation: test_reconciliation_crud.py
  - /admin/audit-log: test_admin_audit_log.py
  - /admin/email-outbox GET: test_admin_email_outbox.py
  - /admin/exception-buckets POST (analyst): test_admin_exception_buckets.py
  - /admin/exception-buckets PATCH (analyst): test_admin_exception_buckets.py
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING, cast

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.email_outbox import EmailOutbox
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.party import PartyCanonical
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


def _csrf(client: TestClient) -> str:
    return client.cookies.get("csrf_token") or ""


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient,
    db_session: Session,
    email: str = "analyst_gap@emb.global",
    entity_code: str | None = "IND",
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    if entity_code:
        entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
        assert entity is not None
        user.entity_id_scope = entity.id
    else:
        user.entity_id_scope = None
    user.is_active = True
    db_session.flush()


def _login_as_cfo(
    client: TestClient, db_session: Session, email: str = "cfo_gap@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _login_as_pending(
    client: TestClient, db_session: Session, email: str = "pending_gap@emb.global"
) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.PENDING
    user.is_active = True
    db_session.flush()


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


def _make_staged_snapshot(db_session: Session, entity_code: str = "IND") -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    snap = Snapshot(
        entity_id=entity_id,
        as_of_date=date(2026, 1, 31),
        status="STAGED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
        parse_result_json={"warnings": [], "rows": []},
    )
    db_session.add(snap)
    db_session.flush()
    return cast(uuid.UUID, snap.id)


def _make_pending_user(
    client: TestClient, db_session: Session, email: str = "target_pending@emb.global"
) -> uuid.UUID:
    """Ensure a PENDING user row exists via the stub OAuth callback.

    Uses the same OAuth stub path as _create_pending() in test_admin_users.py
    so the user row is created with all NOT-NULL defaults (name, etc.) that
    the stub fills in.  Role is left at the default PENDING; is_active is
    forced False so the approve route has a meaningful target.

    Side-effect: the client's session cookie switches to this user.
    Call the requestor login after this.
    """
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.PENDING
    user.is_active = False
    db_session.flush()
    return cast(uuid.UUID, user.id)


def _make_active_user(
    client: TestClient, db_session: Session, email: str = "active_target@emb.global"
) -> uuid.UUID:
    """Ensure an active ANALYST user row exists via stub OAuth callback.

    Side-effect: the client's session cookie switches to this user.
    Call the requestor login after this.
    """
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    user.is_active = True
    db_session.flush()
    return cast(uuid.UUID, user.id)


def _make_inactive_user(
    client: TestClient, db_session: Session, email: str = "inactive_target@emb.global"
) -> uuid.UUID:
    """Ensure an inactive ANALYST user row exists via stub OAuth callback.

    Side-effect: the client's session cookie switches to this user.
    Call the requestor login after this.
    """
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.ANALYST
    user.is_active = False
    db_session.flush()
    return cast(uuid.UUID, user.id)


def _make_queued_email(db_session: Session) -> uuid.UUID:
    """Create a QUEUED email outbox row. recipients_json uses server default ('[]')."""
    row = EmailOutbox(
        rule_type="PUBLISH_NOTIF",
        subject="Test email",
        body_html="<p>test</p>",
        status="QUEUED",
    )
    db_session.add(row)
    db_session.flush()
    return cast(uuid.UUID, row.id)


def _get_active_bucket_id(db_session: Session) -> uuid.UUID:
    bt = db_session.scalar(select(ExceptionBucketType).where(ExceptionBucketType.active.is_(True)))
    assert bt is not None, "No active ExceptionBucketType seeded"
    return cast(uuid.UUID, bt.id)


def _make_open_invoice(db_session: Session, entity_code: str = "IND") -> uuid.UUID:
    admin = _admin_id(db_session)
    entity_id = _entity_id(db_session, entity_code)
    snap = Snapshot(
        entity_id=entity_id,
        as_of_date=date(2026, 1, 31),
        status="PUBLISHED",
        source_hint="TALLY",
        upload_file_sha256=uuid.uuid4().hex,
        uploaded_by=admin,
    )
    db_session.add(snap)
    db_session.flush()
    canonical = PartyCanonical(
        entity_id=entity_id,
        name=f"GapParty-{uuid.uuid4().hex[:6]}",
        created_by=admin,
    )
    db_session.add(canonical)
    db_session.flush()
    inv = Invoice(
        invoice_ref=f"GAP-INV-{uuid.uuid4().hex[:6]}",
        invoice_date=date(2026, 1, 15),
        amount=5000.0,
        currency="INR",
        due_date=date(2026, 2, 14),
        status="OPEN",
        entity_id=entity_id,
        canonical_id=canonical.id,
        first_seen_snapshot_id=snap.id,
        credit_days_applied=30,
        credit_days_source="MANUAL",
        raw_row_json={},
    )
    db_session.add(inv)
    db_session.flush()
    return cast(uuid.UUID, inv.id)


def _make_active_exception_tag(db_session: Session, invoice_id: uuid.UUID) -> uuid.UUID:
    admin = _admin_id(db_session)
    bucket_id = _get_active_bucket_id(db_session)
    tag = ExceptionTag(
        invoice_id=invoice_id,
        bucket_type_id=bucket_id,
        reason="Gap test reason",
        tagged_by=admin,
        status="ACTIVE",
    )
    db_session.add(tag)
    db_session.flush()
    return cast(uuid.UUID, tag.id)


# ===========================================================================
# POST /snapshots/{id}/staging/bulk-create-canonicals
# RBAC: ANALYST(entity-scoped) + ADMIN. CFO/PENDING → 403.
# ===========================================================================


def test_bulk_create_canonicals_cfo_403(client: TestClient, db_session: Session) -> None:
    """CFO cannot call bulk-create-canonicals (write op)."""
    _login_as_admin(client)
    snap_id = _make_staged_snapshot(db_session, entity_code="IND")

    _login_as_cfo(client, db_session)
    resp = client.post(
        f"/snapshots/{snap_id}/staging/bulk-create-canonicals",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_bulk_create_canonicals_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot call bulk-create-canonicals."""
    _login_as_admin(client)
    snap_id = _make_staged_snapshot(db_session, entity_code="IND")

    _login_as_pending(client, db_session)
    resp = client.post(
        f"/snapshots/{snap_id}/staging/bulk-create-canonicals",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_bulk_create_canonicals_analyst_cross_entity_403(
    client: TestClient, db_session: Session
) -> None:
    """ANALYST scoped to IND cannot act on a UAE snapshot."""
    _login_as_admin(client)
    snap_id = _make_staged_snapshot(db_session, entity_code="UAE")

    _login_as_analyst(client, db_session, entity_code="IND")
    resp = client.post(
        f"/snapshots/{snap_id}/staging/bulk-create-canonicals",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /admin/users/{id}/approve
# RBAC: ADMIN only.
# ===========================================================================


def test_approve_user_analyst_403(client: TestClient, db_session: Session) -> None:
    """ANALYST cannot approve users — ADMIN-only endpoint."""
    # Target created first (stub OAuth); then requestor session replaces the cookie.
    target_id = _make_pending_user(client, db_session, "target_for_approve_a@emb.global")
    _login_as_analyst(client, db_session, entity_code=None)
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/approve",
        data={"role": "ANALYST", "csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


def test_approve_user_cfo_403(client: TestClient, db_session: Session) -> None:
    """CFO cannot approve users — ADMIN-only endpoint."""
    target_id = _make_pending_user(client, db_session, "target_for_approve_c@emb.global")
    _login_as_cfo(client, db_session)
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/approve",
        data={"role": "ANALYST", "csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


def test_approve_user_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot approve users — ADMIN-only endpoint."""
    target_id = _make_pending_user(client, db_session, "target_for_approve_p@emb.global")
    _login_as_pending(client, db_session, "requestor_pending@emb.global")
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/approve",
        data={"role": "ANALYST", "csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /admin/users/{id}/deactivate
# RBAC: ADMIN only.
# ===========================================================================


def test_deactivate_user_analyst_403(client: TestClient, db_session: Session) -> None:
    """ANALYST cannot deactivate users."""
    target_id = _make_active_user(client, db_session, "target_deact_a@emb.global")
    _login_as_analyst(client, db_session, entity_code=None)
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/deactivate",
        data={"csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


def test_deactivate_user_cfo_403(client: TestClient, db_session: Session) -> None:
    """CFO cannot deactivate users."""
    target_id = _make_active_user(client, db_session, "target_deact_c@emb.global")
    _login_as_cfo(client, db_session)
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/deactivate",
        data={"csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


def test_deactivate_user_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot deactivate users."""
    target_id = _make_active_user(client, db_session, "target_deact_p@emb.global")
    _login_as_pending(client, db_session, "requestor_deact_p@emb.global")
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/deactivate",
        data={"csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /admin/users/{id}/reactivate
# RBAC: ADMIN only.
# ===========================================================================


def test_reactivate_user_analyst_403(client: TestClient, db_session: Session) -> None:
    """ANALYST cannot reactivate users."""
    target_id = _make_inactive_user(client, db_session, "target_react_a@emb.global")
    _login_as_analyst(client, db_session, entity_code=None)
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/reactivate",
        data={"csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


def test_reactivate_user_cfo_403(client: TestClient, db_session: Session) -> None:
    """CFO cannot reactivate users."""
    target_id = _make_inactive_user(client, db_session, "target_react_c@emb.global")
    _login_as_cfo(client, db_session)
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/reactivate",
        data={"csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


def test_reactivate_user_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot reactivate users."""
    target_id = _make_inactive_user(client, db_session, "target_react_p@emb.global")
    _login_as_pending(client, db_session, "requestor_react_p@emb.global")
    csrf = _csrf(client)
    resp = client.post(
        f"/admin/users/{target_id}/reactivate",
        data={"csrf_token": csrf},
        follow_redirects=False,
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /admin/email-outbox/{id}/mark-sent
# RBAC: ADMIN only.  Gap: PENDING (CFO + analyst already covered).
# ===========================================================================


def test_mark_email_sent_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot manually mark email as sent."""
    _login_as_admin(client)
    outbox_id = _make_queued_email(db_session)

    _login_as_pending(client, db_session, "pending_email_gap@emb.global")
    resp = client.post(
        f"/admin/email-outbox/{outbox_id}/mark-sent",
        json={},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /admin/exception-buckets
# RBAC: ADMIN only.  Gap: PENDING (CFO + analyst already covered).
# ===========================================================================


def test_post_exception_bucket_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot create exception bucket types."""
    _login_as_pending(client, db_session, "pending_bucket_gap@emb.global")
    resp = client.post(
        "/admin/exception-buckets",
        json={"code": "PENDING_TEST_BUCKET", "name": "Should Fail"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ===========================================================================
# PATCH /admin/exception-buckets/{id}
# RBAC: ADMIN only.  Gaps: CFO 403, PENDING 403
# (ANALYST already covered in test_admin_exception_buckets.py)
# ===========================================================================


def test_patch_exception_bucket_cfo_403(client: TestClient, db_session: Session) -> None:
    """CFO cannot patch exception bucket types — ADMIN-only write."""
    _login_as_cfo(client, db_session)
    bt_id = _get_active_bucket_id(db_session)
    resp = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"name": "CFO Rename Attempt"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


def test_patch_exception_bucket_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot patch exception bucket types."""
    _login_as_pending(client, db_session, "pending_patch_bucket@emb.global")
    bt_id = _get_active_bucket_id(db_session)
    resp = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"name": "PENDING Rename Attempt"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /config/fx-rates
# RBAC: ADMIN only.  Gap: PENDING (CFO + analyst already covered).
# ===========================================================================


def test_post_fx_rate_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot create FX rate rows."""
    _login_as_pending(client, db_session, "pending_fx_gap@emb.global")
    resp = client.post(
        "/config/fx-rates",
        json={
            "from_ccy": "AED",
            "to_ccy": "INR",
            "rate": "22.5",
            "valid_from": "2026-06-01",
            "source": "MANUAL",
        },
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ===========================================================================
# POST /invoices/{id}/exceptions
# RBAC: ANALYST(entity-scoped) + ADMIN.  Gap: PENDING
# (CFO + analyst cross-entity already in test_exceptions_crud.py)
# ===========================================================================


def test_create_exception_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot tag an invoice with an exception."""
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, entity_code="IND")

    bt = db_session.scalar(select(ExceptionBucketType).where(ExceptionBucketType.active.is_(True)))
    assert bt is not None

    _login_as_pending(client, db_session, "pending_exc_gap@emb.global")
    resp = client.post(
        f"/invoices/{invoice_id}/exceptions",
        json={"bucket_type_code": bt.code, "reason": "Should fail"},
        headers=_headers(client),
    )
    assert resp.status_code == 403


# ===========================================================================
# PATCH /exceptions/{id}
# RBAC: ANALYST(entity-scoped) + ADMIN.  Gap: PENDING
# (CFO already in test_exceptions_crud.py)
# ===========================================================================


def test_patch_exception_pending_403(client: TestClient, db_session: Session) -> None:
    """PENDING cannot resolve an exception tag."""
    _login_as_admin(client)
    invoice_id = _make_open_invoice(db_session, entity_code="IND")
    tag_id = _make_active_exception_tag(db_session, invoice_id)

    _login_as_pending(client, db_session, "pending_patch_exc@emb.global")
    resp = client.patch(
        f"/exceptions/{tag_id}",
        json={"action": "RESOLVE", "resolution_note": "Should fail"},
        headers=_headers(client),
    )
    assert resp.status_code == 403
