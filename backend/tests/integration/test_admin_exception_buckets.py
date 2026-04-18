"""Integration tests for GET/POST/PATCH /admin/exception-buckets (M6 Group F).

Spec §D9: Seeds present (DISPUTE, CREDIT_HOLD, PAYMENT_PLAN, PENDING_DOCS).
ADMIN only for writes. All non-PENDING roles for reads.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.exception_bucket_type import ExceptionBucketType
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
    return client.cookies.get("csrf_token", "")


def _login_as_admin(client: TestClient) -> None:
    _login(client, "tejaswa.sharma@emb.global")


def _login_as_analyst(
    client: TestClient, db_session: Session, email: str = "analyst@emb.global"
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


def _post_bucket(
    client: TestClient,
    code: str = "TEST_BUCKET",
    name: str = "Test Bucket",
    description: str | None = None,
) -> Any:
    body: dict[str, Any] = {"code": code, "name": name}
    if description:
        body["description"] = description
    return client.post("/admin/exception-buckets", json=body, headers=_headers(client))


# ---------------------------------------------------------------------------
# D9 seed verification
# ---------------------------------------------------------------------------


def test_d9_seeds_present(client: TestClient, db_session: Session) -> None:
    """All four D9 exception bucket seeds must be present after migration."""
    _login_as_admin(client)
    expected_codes = {"DISPUTE", "CREDIT_HOLD", "PAYMENT_PLAN", "PENDING_DOCS"}
    actual = db_session.scalars(select(ExceptionBucketType)).all()
    actual_codes = {b.code for b in actual}
    missing = expected_codes - actual_codes
    assert not missing, f"D9 seeds missing: {missing}"


def test_d9_seeds_active_by_default(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    for code in ("DISPUTE", "CREDIT_HOLD", "PAYMENT_PLAN", "PENDING_DOCS"):
        bt = db_session.scalar(
            select(ExceptionBucketType).where(ExceptionBucketType.code == code)
        )
        assert bt is not None
        assert bt.is_active is True, f"{code} should be active"


# ---------------------------------------------------------------------------
# GET /admin/exception-buckets
# ---------------------------------------------------------------------------


def test_get_exception_buckets_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.get("/admin/exception-buckets")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert len(body["items"]) >= 4


def test_get_exception_buckets_200_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/admin/exception-buckets")
    assert resp.status_code == 200


def test_get_exception_buckets_200_cfo(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = client.get("/admin/exception-buckets")
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /admin/exception-buckets
# ---------------------------------------------------------------------------


def test_post_exception_bucket_201_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = _post_bucket(client, code="LEGAL_HOLD", name="Legal Hold")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["code"] == "LEGAL_HOLD"
    assert body["name"] == "Legal Hold"
    assert body["is_active"] is True


def test_post_exception_bucket_duplicate_code_409(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    _post_bucket(client, code="DUPLICATE_CODE", name="First")
    resp = _post_bucket(client, code="DUPLICATE_CODE", name="Second")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "BUCKET_CODE_EXISTS"


def test_post_exception_bucket_analyst_403(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = _post_bucket(client, code="ANALYST_BUCKET")
    assert resp.status_code == 403


def test_post_exception_bucket_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = _post_bucket(client, code="CFO_BUCKET")
    assert resp.status_code == 403


def test_post_exception_bucket_writes_audit_log(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    from app.db.models.audit_log import AuditLog

    before = db_session.query(AuditLog).filter(
        AuditLog.action == "exception_bucket.create"
    ).count()
    _post_bucket(client, code="AUDIT_BUCKET", name="Audit test")
    after = db_session.query(AuditLog).filter(
        AuditLog.action == "exception_bucket.create"
    ).count()
    assert after == before + 1


# ---------------------------------------------------------------------------
# PATCH /admin/exception-buckets/:id
# ---------------------------------------------------------------------------


def _get_bucket_id(db_session: Session, code: str) -> uuid.UUID:
    bt = db_session.scalar(select(ExceptionBucketType).where(ExceptionBucketType.code == code))
    assert bt is not None
    return bt.id


def test_patch_exception_bucket_toggle_inactive(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    _post_bucket(client, code="TOGGLE_ME", name="Toggle")
    bt_id = _get_bucket_id(db_session, "TOGGLE_ME")

    resp = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"is_active": False},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["is_active"] is False

    # Toggle back active
    resp2 = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"is_active": True},
        headers=_headers(client),
    )
    assert resp2.status_code == 200
    assert resp2.json()["is_active"] is True


def test_patch_exception_bucket_update_name(
    client: TestClient, db_session: Session
) -> None:
    _login_as_admin(client)
    _post_bucket(client, code="RENAME_ME", name="OldName")
    bt_id = _get_bucket_id(db_session, "RENAME_ME")

    resp = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"name": "NewName"},
        headers=_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    assert resp.json()["name"] == "NewName"


def test_patch_exception_bucket_code_immutable(
    client: TestClient, db_session: Session
) -> None:
    """Attempting to change code should be rejected (409 or 422)."""
    _login_as_admin(client)
    _post_bucket(client, code="IMMUT_CODE", name="ImmutCode")
    bt_id = _get_bucket_id(db_session, "IMMUT_CODE")

    resp = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"code": "CHANGED_CODE"},
        headers=_headers(client),
    )
    # Either 409 (conflict) or 422 (validation error) — both acceptable
    assert resp.status_code in (409, 422), resp.json()


def test_patch_exception_bucket_404(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.patch(
        f"/admin/exception-buckets/{uuid.uuid4()}",
        json={"is_active": False},
        headers=_headers(client),
    )
    assert resp.status_code == 404


def test_patch_exception_bucket_analyst_403(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    bt_id = _get_bucket_id(db_session, "DISPUTE")
    resp = client.patch(
        f"/admin/exception-buckets/{bt_id}",
        json={"is_active": False},
        headers=_headers(client),
    )
    assert resp.status_code == 403
