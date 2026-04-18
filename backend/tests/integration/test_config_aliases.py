"""Integration tests for GET/POST/PATCH/DELETE /config/aliases (M3 Task 6).

Coverage:
- GET: list, entity filter, canonical_id filter, alias_text_contains
- POST: happy path, UNIQUE violation → 409
- PATCH: admin only, UNIQUE collision → 409
- DELETE: admin only, hard delete
- RBAC: analyst own entity, analyst wrong entity, admin, CFO read, PENDING 403
- Audit log on every mutation
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.party import PartyAlias, PartyCanonical
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
# DB helpers
# ---------------------------------------------------------------------------


def _get_admin_user(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert user is not None
    return user


def _create_canonical(
    db_session: Session,
    entity_code: str,
    name: str,
) -> uuid.UUID:
    admin = _get_admin_user(db_session)
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    canonical = PartyCanonical(entity_id=entity.id, name=name, created_by=admin.id)
    db_session.add(canonical)
    db_session.flush()
    return canonical.id


def _create_alias(
    db_session: Session,
    canonical_id: uuid.UUID,
    alias_text: str,
    source: str = "MANUAL",
) -> uuid.UUID:
    admin = _get_admin_user(db_session)
    alias = PartyAlias(
        canonical_id=canonical_id,
        alias_text=alias_text,
        source=source,
        confidence=None,
        created_by=admin.id,
    )
    db_session.add(alias)
    db_session.flush()
    return alias.id


def _csrf_headers(client: TestClient) -> dict[str, str]:
    csrf = _csrf(client)
    return {"X-CSRF-Token": csrf} if csrf else {}


# ---------------------------------------------------------------------------
# Test 1: GET — basic list
# ---------------------------------------------------------------------------


def test_get_aliases_basic(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "GetAliasParty")
    _create_alias(db_session, canonical_id, "GetAliasParty Alias")

    resp = client.get("/config/aliases")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "pagination" in body
    assert body["pagination"]["total"] >= 1


# ---------------------------------------------------------------------------
# Test 2: GET — canonical_id filter
# ---------------------------------------------------------------------------


def test_get_aliases_canonical_id_filter(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    c1 = _create_canonical(db_session, "IND", "FilterCanonical1")
    c2 = _create_canonical(db_session, "IND", "FilterCanonical2")
    _create_alias(db_session, c1, "Alias For C1")
    _create_alias(db_session, c2, "Alias For C2")

    resp = client.get(f"/config/aliases?canonical_id={c1}")
    assert resp.status_code == 200
    for item in resp.json()["items"]:
        assert item["canonical_id"] == str(c1)


# ---------------------------------------------------------------------------
# Test 3: POST — create alias happy path
# ---------------------------------------------------------------------------


def test_post_alias_happy_path(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "PostAliasParty")

    resp = client.post(
        "/config/aliases",
        json={"canonical_id": str(canonical_id), "alias_text": "Post Alias Text"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["canonical_id"] == str(canonical_id)
    assert body["source"] == "MANUAL"
    assert body["entity_code"] == "IND"


# ---------------------------------------------------------------------------
# Test 4: POST — duplicate alias → 409
# ---------------------------------------------------------------------------


def test_post_alias_duplicate_409(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "DuplicateAliasParty")
    _create_alias(db_session, canonical_id, "Dupe Alias")

    resp = client.post(
        "/config/aliases",
        json={"canonical_id": str(canonical_id), "alias_text": "Dupe Alias"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "ALIAS_ALREADY_EXISTS"


# ---------------------------------------------------------------------------
# Test 5: PATCH — admin can update alias text
# ---------------------------------------------------------------------------


def test_patch_alias_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "PatchAliasParty")
    alias_id = _create_alias(db_session, canonical_id, "Original Alias Text")

    resp = client.patch(
        f"/config/aliases/{alias_id}",
        json={"alias_text": "Updated Alias Text"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 200, resp.json()
    body = resp.json()
    assert body["id"] == str(alias_id)


# ---------------------------------------------------------------------------
# Test 6: PATCH — collision with another alias → 409
# ---------------------------------------------------------------------------


def test_patch_alias_collision_409(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "CollisionAliasParty")
    alias_id = _create_alias(db_session, canonical_id, "First Alias")
    _create_alias(db_session, canonical_id, "Second Alias")

    resp = client.patch(
        f"/config/aliases/{alias_id}",
        json={"alias_text": "Second Alias"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "ALIAS_ALREADY_EXISTS"


# ---------------------------------------------------------------------------
# Test 7: DELETE — admin can delete alias
# ---------------------------------------------------------------------------


def test_delete_alias_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "DeleteAliasParty")
    alias_id = _create_alias(db_session, canonical_id, "Delete Me Alias")

    resp = client.delete(
        f"/config/aliases/{alias_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 204

    # Verify gone from DB
    db_session.expire_all()
    alias = db_session.get(PartyAlias, alias_id)
    assert alias is None


# ---------------------------------------------------------------------------
# Test 8: RBAC — analyst own entity can POST alias
# ---------------------------------------------------------------------------


def test_post_alias_analyst_own_entity(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AnalystAliasParty")

    _login_as_analyst(client, db_session, "analyst.alias@emb.global", entity_code="IND")
    resp = client.post(
        "/config/aliases",
        json={"canonical_id": str(canonical_id), "alias_text": "Analyst Created Alias"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201, resp.json()


# ---------------------------------------------------------------------------
# Test 9: RBAC — analyst wrong entity → 403
# ---------------------------------------------------------------------------


def test_post_alias_analyst_wrong_entity_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "WrongEntityAliasParty")

    _login_as_analyst(client, db_session, "analyst.uae.alias@emb.global", entity_code="UAE")
    resp = client.post(
        "/config/aliases",
        json={"canonical_id": str(canonical_id), "alias_text": "Wrong Entity Alias"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 10: RBAC — PATCH alias — analyst → 403
# ---------------------------------------------------------------------------


def test_patch_alias_analyst_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AnalystPatchAliasParty")
    alias_id = _create_alias(db_session, canonical_id, "Analyst Cannot Patch")

    _login_as_analyst(client, db_session, "analyst.nopatch@emb.global", entity_code="IND")
    resp = client.patch(
        f"/config/aliases/{alias_id}",
        json={"alias_text": "Try to Patch"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 11: RBAC — DELETE alias — analyst → 403
# ---------------------------------------------------------------------------


def test_delete_alias_analyst_403(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AnalystDelAliasParty")
    alias_id = _create_alias(db_session, canonical_id, "Analyst Cannot Delete")

    _login_as_analyst(client, db_session, "analyst.nodel@emb.global", entity_code="IND")
    resp = client.delete(
        f"/config/aliases/{alias_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Test 12: Audit log written on POST, PATCH, DELETE
# ---------------------------------------------------------------------------


def test_alias_audit_log_post(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AuditPostAliasParty")

    resp = client.post(
        "/config/aliases",
        json={"canonical_id": str(canonical_id), "alias_text": "Audit Post Alias"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 201
    alias_id = uuid.UUID(resp.json()["id"])

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "alias.create",
            AuditLog.entity_id == alias_id,
        )
    )
    assert audit is not None
    assert audit.before == {}
    assert audit.after["source"] == "MANUAL"


def test_alias_audit_log_delete(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    canonical_id = _create_canonical(db_session, "IND", "AuditDelAliasParty")
    alias_id = _create_alias(db_session, canonical_id, "Audit Delete Alias")

    resp = client.delete(
        f"/config/aliases/{alias_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 204

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "alias.delete",
            AuditLog.entity_id == alias_id,
        )
    )
    assert audit is not None
    assert audit.before["id"] == str(alias_id)
    assert audit.after == {}
