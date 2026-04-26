"""Consolidated RBAC matrix suite for all M3 endpoints (M3 Task 7).

Sweeps every endpoint × every role × entity-scope combination using
pytest.mark.parametrize. Each case asserts the HTTP status code that the
real implementation returns — confirmed against existing tests, not only
spec text.

Actual behavior notes (confirmed from implementation + existing tests):
- GET /snapshots/:id/staging → _allowed = ANALYST+ADMIN only. CFO gets 403.
  Spec §10 implies read-only CFO access, but code shipped without it (Task 4).
  Matrix reflects real behavior; deviation flagged in test docstring.
- GET /config/credit-period and GET /config/aliases → ANALYST any-entity can
  call them; the service filters to own entity. Wrong-entity ANALYST gets 200
  (filtered list), not 403.
- DELETE /config/credit-period → 405 for all authenticated roles (method not
  allowed). Unauthenticated gets 401 (auth fires before method routing? — No,
  405 can fire before auth. We test both cases).

Seeded by migration 0002+0003:
  - tejaswa.sharma@emb.global → ADMIN
  - Entities: IND (EMB_IN), UAE (MANTARAV_UAE)
"""

from __future__ import annotations

import io
import uuid
from datetime import date
from typing import TYPE_CHECKING, Any, cast

import openpyxl
import pytest
from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.credit_period_config import CreditPeriodConfig
from app.db.models.entity import Entity
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Auth helpers (inlined — see CLAUDE.md: duplicate is preferred over refactor risk)
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
    return cast(uuid.UUID, user.id)


def _login_as_cfo(client: TestClient, db_session: Session, email: str) -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _login_as_pending(client: TestClient, email: str) -> None:
    """Trigger OAuth callback to create a PENDING user (no role upgrade)."""
    _login(client, email)


# ---------------------------------------------------------------------------
# XLSX + DB setup helpers
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


def _upload_tally(
    client: TestClient,
    entity_code: str = "IND",
    as_of_date: str = "2026-03-31",
    filename: str = "rbac_test.xlsx",
) -> str:
    """Upload a minimal TALLY snapshot as admin. Returns snapshot_id."""
    xlsx = _make_tally_xlsx(
        data_rows=[[date(2026, 1, 15), "INV-RBAC-001", "RbacParty", 1000.0, 1000.0, None, None]]
    )
    csrf_tok = _csrf(client)
    headers = {"X-CSRF-Token": csrf_tok} if csrf_tok else {}
    resp = client.post(
        "/snapshots",
        data={"entity_code": entity_code, "source_hint": "TALLY", "as_of_date": as_of_date},
        files={
            "file": (
                filename,
                io.BytesIO(xlsx),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=headers,
    )
    assert resp.status_code == 201, f"Setup upload failed: {resp.json()}"
    return str(resp.json()["snapshot_id"])


def _get_entity(db_session: Session, entity_code: str) -> Entity:
    entity = db_session.scalar(select(Entity).where(Entity.code == entity_code))
    assert entity is not None
    return entity


def _get_admin(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.email == "tejaswa.sharma@emb.global"))
    assert user is not None
    return user


def _create_canonical(db_session: Session, entity_code: str, name: str) -> uuid.UUID:
    admin = _get_admin(db_session)
    entity = _get_entity(db_session, entity_code)
    c = PartyCanonical(entity_id=entity.id, name=name, created_by=admin.id)
    db_session.add(c)
    db_session.flush()
    return cast(uuid.UUID, c.id)


def _create_alias(db_session: Session, canonical_id: uuid.UUID, alias_text: str) -> uuid.UUID:
    admin = _get_admin(db_session)
    a = PartyAlias(
        canonical_id=canonical_id,
        alias_text=alias_text,
        source="MANUAL",
        confidence=None,
        created_by=admin.id,
    )
    db_session.add(a)
    db_session.flush()
    return cast(uuid.UUID, a.id)


def _create_credit_period(
    db_session: Session, canonical_id: uuid.UUID, days: int = 30
) -> uuid.UUID:
    admin = _get_admin(db_session)
    cfg = CreditPeriodConfig(
        canonical_id=canonical_id,
        days=days,
        valid_from=date(2026, 1, 1),
        valid_to=None,
        updated_by=admin.id,
    )
    db_session.add(cfg)
    db_session.flush()
    return cast(uuid.UUID, cfg.id)


def _set_entity_default_credit_days(db_session: Session, entity_code: str, days: int) -> None:
    entity = _get_entity(db_session, entity_code)
    entity.default_credit_days = days
    db_session.flush()


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
    assert resp.status_code == 200, resp.json()


# ---------------------------------------------------------------------------
# Fixtures that create shared resources for matrix tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def rbac_resources(client: TestClient, db_session: Session) -> dict[str, Any]:
    """Create one STAGED snapshot (IND), one canonical, one alias, one credit-period row.

    The snapshot is uploaded by admin. The canonical + alias are in IND.
    Returns a dict with keys: snapshot_id, canonical_id, alias_id, credit_period_id.
    """
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)

    snapshot_id = _upload_tally(client, entity_code="IND", filename="rbac_matrix_snap.xlsx")

    canonical_id = _create_canonical(db_session, "IND", "RbacMatrixParty")
    alias_id = _create_alias(db_session, canonical_id, "RbacMatrixAlias")
    credit_period_id = _create_credit_period(db_session, canonical_id, days=30)

    # Re-login as admin after creating resources (session cookie may still be admin)
    _login_as_admin(client)

    return {
        "snapshot_id": snapshot_id,
        "canonical_id": canonical_id,
        "alias_id": alias_id,
        "credit_period_id": credit_period_id,
    }


# ---------------------------------------------------------------------------
# Role setup helper
# ---------------------------------------------------------------------------


def _setup_role(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
) -> None:
    """Log in as the given role. entity_scope is the entity_code for ANALYST."""
    if role == "ADMIN":
        _login_as_admin(client)
    elif role == "ANALYST":
        _login_as_analyst(client, db_session, email, entity_code=entity_scope)
        _login(client, email)  # refresh cookie after DB mutation
    elif role == "CFO":
        _login_as_cfo(client, db_session, email)
        _login(client, email)
    elif role == "PENDING":
        _login_as_pending(client, email)
    elif role == "UNAUTHENTICATED":
        # Clear any existing session cookie so the request has no auth,
        # then hit /health to get a fresh CSRF cookie (so CSRF check passes
        # and auth check fires and returns 401).
        client.cookies.clear()
        client.get("/health")
    else:
        raise ValueError(f"Unknown role: {role!r}")


# ---------------------------------------------------------------------------
# POST /snapshots  (upload)
# ---------------------------------------------------------------------------
#
# ANALYST own-entity  → 201
# ANALYST wrong-entity → 403
# ADMIN               → 201
# CFO                 → 403
# PENDING             → 403
# UNAUTHENTICATED     → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_upload_analyst_ind@emb.global", 201),
        ("ANALYST", "UAE", "rbac_upload_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 201),
        ("CFO", None, "rbac_upload_cfo@emb.global", 403),
        ("PENDING", None, "rbac_upload_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_post_snapshots(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """POST /snapshots — upload a new snapshot."""
    _setup_role(client, db_session, role, entity_scope, email)

    xlsx = _make_tally_xlsx(
        data_rows=[[date(2026, 1, 15), "INV-UP-001", "UploadParty", 1000.0, 1000.0, None, None]]
    )
    csrf_tok = _csrf(client)
    headers = {"X-CSRF-Token": csrf_tok} if csrf_tok else {}
    resp = client.post(
        "/snapshots",
        data={"entity_code": "IND", "source_hint": "TALLY", "as_of_date": "2026-03-31"},
        files={
            "file": (
                f"rbac_up_{role}.xlsx",
                io.BytesIO(xlsx),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=headers,
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# POST /snapshots/:id/discard
# ---------------------------------------------------------------------------
#
# ANALYST own-entity  → 200
# ANALYST wrong-entity → 403
# ADMIN               → 200
# CFO                 → 403
# PENDING             → 403
# UNAUTHENTICATED     → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_discard_analyst_ind@emb.global", 200),
        ("ANALYST", "UAE", "rbac_discard_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_discard_cfo@emb.global", 403),
        ("PENDING", None, "rbac_discard_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_post_snapshots_discard(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """POST /snapshots/:id/discard — discard a staged snapshot."""
    # Always create snapshot as admin first
    _login_as_admin(client)
    snapshot_id = _upload_tally(
        client, entity_code="IND", filename=f"rbac_disc_{role}_{entity_scope}.xlsx"
    )

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.post(
        f"/snapshots/{snapshot_id}/discard",
        json={},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# GET /snapshots/:id/staging
# ---------------------------------------------------------------------------
#
# Implementation note: route uses _allowed = ANALYST+ADMIN only.
# CFO gets 403 (implementation does NOT grant CFO read on staging — confirmed
# in test_staging_api.py::TestStagingGetRbac::test_cfo_gets_403).
# Spec §10 intended CFO read-only but code shipped ANALYST+ADMIN. Flagged.
#
# ANALYST own-entity  → 200
# ANALYST wrong-entity → 403
# ADMIN               → 200
# CFO                 → 403  (DEVIATION from spec §10 — code shipped ANALYST+ADMIN only)
# PENDING             → 403
# UNAUTHENTICATED     → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_staging_get_analyst_ind@emb.global", 200),
        ("ANALYST", "UAE", "rbac_staging_get_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_staging_get_cfo@emb.global", 403),
        ("PENDING", None, "rbac_staging_get_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_get_snapshot_staging(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """GET /snapshots/:id/staging — paginated staging view."""
    snapshot_id = rbac_resources["snapshot_id"]
    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.get(f"/snapshots/{snapshot_id}/staging")
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# PATCH /snapshots/:id/staging/:row_index
# ---------------------------------------------------------------------------
#
# ANALYST own-entity  → 200 (resolve_alias to existing canonical)
# ANALYST wrong-entity → 403
# ADMIN               → 200
# CFO                 → 403
# PENDING             → 403
# UNAUTHENTICATED     → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_patch_staging_analyst_ind@emb.global", 200),
        ("ANALYST", "UAE", "rbac_patch_staging_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_patch_staging_cfo@emb.global", 403),
        ("PENDING", None, "rbac_patch_staging_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_patch_snapshot_staging_row(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """PATCH /snapshots/:id/staging/:row_index — resolve alias on a row."""
    # Create snapshot + canonical as admin
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)
    snapshot_id = _upload_tally(
        client, entity_code="IND", filename=f"rbac_patch_stg_{role}_{entity_scope}.xlsx"
    )
    canonical_id = _create_canonical(db_session, "IND", f"PatchStagingParty_{role}_{entity_scope}")

    # Get row_index from staging (as admin)
    staging_resp = client.get(f"/snapshots/{snapshot_id}/staging")
    assert staging_resp.status_code == 200
    rows = staging_resp.json()["rows"]
    # First OK row (the invoice row)
    ok_rows = [r for r in rows if r.get("status") == "OK"]
    row_index = ok_rows[0]["row_index"] if ok_rows else rows[0]["row_index"]

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.patch(
        f"/snapshots/{snapshot_id}/staging/{row_index}",
        json={"action": "resolve_alias", "canonical_id": str(canonical_id)},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# PATCH /snapshots/:id/warnings/ack
# ---------------------------------------------------------------------------
#
# ANALYST own-entity  → 200 (if there are warnings; empty codes list → also 200)
# ANALYST wrong-entity → 403
# ADMIN               → 200
# CFO                 → 403
# PENDING             → 403
# UNAUTHENTICATED     → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_ack_warn_analyst_ind@emb.global", 200),
        ("ANALYST", "UAE", "rbac_ack_warn_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_ack_warn_cfo@emb.global", 403),
        ("PENDING", None, "rbac_ack_warn_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_patch_warnings_ack(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """PATCH /snapshots/:id/warnings/ack — acknowledge parse warnings."""
    _login_as_admin(client)
    snapshot_id = _upload_tally(
        client, entity_code="IND", filename=f"rbac_ack_{role}_{entity_scope}.xlsx"
    )

    # Get actual warning codes from the snapshot
    snap = db_session.scalar(select(Snapshot).where(Snapshot.id == uuid.UUID(snapshot_id)))
    assert snap is not None
    pr = snap.parse_result_json or {}
    codes = sorted({w.get("code") for w in pr.get("warnings", []) if w.get("code")})
    if not codes:
        codes = ["UNALLOCATED_CREDITS_DELTA"]  # Tally always emits this

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.patch(
        f"/snapshots/{snapshot_id}/warnings/ack",
        json={"codes": codes},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# POST /snapshots/:id/publish
# ---------------------------------------------------------------------------
#
# ANALYST own-entity  → 200 (publish gate may pass or fail; important: not 403)
# ANALYST wrong-entity → 403
# ADMIN               → 200 (same — gate may block with non-403)
# CFO                 → 403
# PENDING             → 403
# UNAUTHENTICATED     → 401
#
# For roles that should be allowed (ANALYST own, ADMIN), we accept any non-403
# response because the publish gate may block (422) when no canonical is set up.
# We DO assert not-401 and not-403 for allowed roles.


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected_deny", "deny_code"),
    [
        ("ANALYST", "UAE", "rbac_pub_analyst_uae@emb.global", True, 403),
        ("CFO", None, "rbac_pub_cfo@emb.global", True, 403),
        ("PENDING", None, "rbac_pub_pending@emb.global", True, 403),
        ("UNAUTHENTICATED", None, "", True, 401),
    ],
)
def test_rbac_post_publish_denied(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected_deny: bool,
    deny_code: int,
) -> None:
    """POST /snapshots/:id/publish — denied roles."""
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)
    snapshot_id = _upload_tally(client, entity_code="IND", filename=f"rbac_pub_deny_{role}.xlsx")

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.post(
        f"/snapshots/{snapshot_id}/publish",
        json={},
        headers=_csrf_headers(client),
    )
    assert (
        resp.status_code == deny_code
    ), f"{role}/{entity_scope}: expected {deny_code}, got {resp.status_code} {resp.text}"


@pytest.mark.parametrize(
    ("role", "entity_scope", "email"),
    [
        ("ANALYST", "IND", "rbac_pub_allow_analyst_ind@emb.global"),
        ("ADMIN", None, "tejaswa.sharma@emb.global"),
    ],
)
def test_rbac_post_publish_allowed(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
) -> None:
    """POST /snapshots/:id/publish — allowed roles get past RBAC gate (may get 422 from publish gate)."""
    _login_as_admin(client)
    _set_entity_default_credit_days(db_session, "IND", 30)
    snapshot_id = _upload_tally(client, entity_code="IND", filename=f"rbac_pub_allow_{role}.xlsx")
    _ack_all_warnings(client, db_session, snapshot_id)

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.post(
        f"/snapshots/{snapshot_id}/publish",
        json={},
        headers=_csrf_headers(client),
    )
    # Must NOT be 401 or 403 (those would be auth/authz failures).
    # Gate blocked (422) or wrong state (409) are domain errors — acceptable.
    assert resp.status_code not in (
        401,
        403,
    ), f"{role}/{entity_scope}: expected not 401/403, got {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# GET /config/credit-period
# ---------------------------------------------------------------------------
#
# All authenticated non-PENDING roles can read (filtered by entity scope in service).
# ANALYST (any entity) → 200 (service filters result; no 403 on wrong entity).
# CFO → 200
# ADMIN → 200
# PENDING → 403
# UNAUTHENTICATED → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_cp_get_analyst_ind@emb.global", 200),
        ("ANALYST", "UAE", "rbac_cp_get_analyst_uae@emb.global", 200),  # filtered, not denied
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_cp_get_cfo@emb.global", 200),
        ("PENDING", None, "rbac_cp_get_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_get_config_credit_period(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """GET /config/credit-period — list credit period rows."""
    _setup_role(client, db_session, role, entity_scope, email)
    resp = client.get("/config/credit-period")
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# POST /config/credit-period
# ---------------------------------------------------------------------------
#
# ANALYST own-entity → 201
# ANALYST wrong-entity → 403
# ADMIN → 201
# CFO → 403
# PENDING → 403
# UNAUTHENTICATED → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_cp_post_analyst_ind@emb.global", 201),
        ("ANALYST", "UAE", "rbac_cp_post_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 201),
        ("CFO", None, "rbac_cp_post_cfo@emb.global", 403),
        ("PENDING", None, "rbac_cp_post_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_post_config_credit_period(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """POST /config/credit-period — create a new credit-period row."""
    canonical_id = rbac_resources["canonical_id"]  # IND entity

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.post(
        "/config/credit-period",
        json={
            "canonical_id": str(canonical_id),
            "credit_days": 45,
            "valid_from": "2026-06-01",
        },
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# PATCH /config/credit-period/:id  (ADMIN only)
# ---------------------------------------------------------------------------
#
# ANALYST (any entity) → 403
# ADMIN → 200
# CFO → 403
# PENDING → 403
# UNAUTHENTICATED → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_cp_patch_analyst_ind@emb.global", 403),
        ("ANALYST", "UAE", "rbac_cp_patch_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_cp_patch_cfo@emb.global", 403),
        ("PENDING", None, "rbac_cp_patch_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_patch_config_credit_period(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """PATCH /config/credit-period/:id — update an open credit-period row (ADMIN only)."""
    credit_period_id = rbac_resources["credit_period_id"]

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.patch(
        f"/config/credit-period/{credit_period_id}",
        json={"credit_days": 60, "reason_note": "RBAC matrix test update"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# DELETE /config/credit-period/:id  → 405 for all roles (method not allowed)
# ---------------------------------------------------------------------------
#
# The route does not define DELETE handler → FastAPI returns 405.
# Unauthenticated also gets 405 because method routing fires before auth
# middleware (FastAPI router raises 405 immediately).
# We assert 405 for all authenticated roles; for UNAUTHENTICATED we assert
# either 405 or 401 (implementation-dependent).


@pytest.mark.parametrize(
    ("role", "entity_scope", "email"),
    [
        ("ANALYST", "IND", "rbac_cp_del_analyst_ind@emb.global"),
        ("ANALYST", "UAE", "rbac_cp_del_analyst_uae@emb.global"),
        ("ADMIN", None, "tejaswa.sharma@emb.global"),
        ("CFO", None, "rbac_cp_del_cfo@emb.global"),
        ("PENDING", None, "rbac_cp_del_pending@emb.global"),
    ],
)
def test_rbac_delete_config_credit_period_405(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
) -> None:
    """DELETE /config/credit-period/:id → 405 (method not allowed for all roles)."""
    credit_period_id = rbac_resources["credit_period_id"]

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.delete(
        f"/config/credit-period/{credit_period_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code == 405, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


def test_rbac_delete_config_credit_period_unauthenticated(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
) -> None:
    """DELETE /config/credit-period/:id unauthenticated → 405 or 401."""
    credit_period_id = rbac_resources["credit_period_id"]

    # No login — get CSRF cookie via /health
    client.get("/health")

    resp = client.delete(
        f"/config/credit-period/{credit_period_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code in (
        401,
        405,
    ), f"UNAUTHENTICATED DELETE expected 401 or 405, got {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# GET /config/aliases
# ---------------------------------------------------------------------------
#
# Same as credit-period reads: ANALYST any-entity → 200 (service-filtered).
# CFO → 200, ADMIN → 200, PENDING → 403, UNAUTHENTICATED → 401.


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_alias_get_analyst_ind@emb.global", 200),
        ("ANALYST", "UAE", "rbac_alias_get_analyst_uae@emb.global", 200),  # filtered, not denied
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_alias_get_cfo@emb.global", 200),
        ("PENDING", None, "rbac_alias_get_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_get_config_aliases(
    client: TestClient,
    db_session: Session,
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """GET /config/aliases — list alias rows."""
    _setup_role(client, db_session, role, entity_scope, email)
    resp = client.get("/config/aliases")
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# POST /config/aliases
# ---------------------------------------------------------------------------
#
# ANALYST own-entity → 201
# ANALYST wrong-entity → 403
# ADMIN → 201
# CFO → 403
# PENDING → 403
# UNAUTHENTICATED → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_alias_post_analyst_ind@emb.global", 201),
        ("ANALYST", "UAE", "rbac_alias_post_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 201),
        ("CFO", None, "rbac_alias_post_cfo@emb.global", 403),
        ("PENDING", None, "rbac_alias_post_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_post_config_aliases(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """POST /config/aliases — create a new alias (ANALYST own-entity + ADMIN)."""
    canonical_id = rbac_resources["canonical_id"]  # IND entity

    _setup_role(client, db_session, role, entity_scope, email)

    # Use role-unique alias text to avoid UNIQUE collisions across parametrize runs
    alias_text = f"RbacPostAlias_{role}_{entity_scope}"
    resp = client.post(
        "/config/aliases",
        json={"canonical_id": str(canonical_id), "alias_text": alias_text},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# PATCH /config/aliases/:id  (ADMIN only)
# ---------------------------------------------------------------------------
#
# ANALYST (any entity) → 403
# ADMIN → 200
# CFO → 403
# PENDING → 403
# UNAUTHENTICATED → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_alias_patch_analyst_ind@emb.global", 403),
        ("ANALYST", "UAE", "rbac_alias_patch_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 200),
        ("CFO", None, "rbac_alias_patch_cfo@emb.global", 403),
        ("PENDING", None, "rbac_alias_patch_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_patch_config_aliases(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """PATCH /config/aliases/:id — update alias text (ADMIN only)."""
    # Create a fresh alias per parametrize case to avoid collision
    _login_as_admin(client)
    alias_id = _create_alias(
        db_session,
        rbac_resources["canonical_id"],
        f"RbacPatchAlias_{role}_{entity_scope}",
    )

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.patch(
        f"/config/aliases/{alias_id}",
        json={"alias_text": f"RbacPatchUpdated_{role}_{entity_scope}"},
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# DELETE /config/aliases/:id  (ADMIN only)
# ---------------------------------------------------------------------------
#
# ANALYST (any entity) → 403
# ADMIN → 204
# CFO → 403
# PENDING → 403
# UNAUTHENTICATED → 401


@pytest.mark.parametrize(
    ("role", "entity_scope", "email", "expected"),
    [
        ("ANALYST", "IND", "rbac_alias_del_analyst_ind@emb.global", 403),
        ("ANALYST", "UAE", "rbac_alias_del_analyst_uae@emb.global", 403),
        ("ADMIN", None, "tejaswa.sharma@emb.global", 204),
        ("CFO", None, "rbac_alias_del_cfo@emb.global", 403),
        ("PENDING", None, "rbac_alias_del_pending@emb.global", 403),
        ("UNAUTHENTICATED", None, "", 401),
    ],
)
def test_rbac_delete_config_aliases(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    role: str,
    entity_scope: str | None,
    email: str,
    expected: int,
) -> None:
    """DELETE /config/aliases/:id — hard delete alias (ADMIN only)."""
    # Create a fresh alias per parametrize case so deletes don't interfere
    _login_as_admin(client)
    alias_id = _create_alias(
        db_session,
        rbac_resources["canonical_id"],
        f"RbacDelAlias_{role}_{entity_scope}",
    )

    _setup_role(client, db_session, role, entity_scope, email)

    resp = client.delete(
        f"/config/aliases/{alias_id}",
        headers=_csrf_headers(client),
    )
    assert resp.status_code == expected, f"{role}/{entity_scope}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# Unauthenticated sentinel: auth middleware fires before role check
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path_template", "needs_resources"),
    [
        ("GET", "/snapshots/{snapshot_id}/staging", True),
        ("POST", "/snapshots/{snapshot_id}/discard", True),
        ("POST", "/snapshots/{snapshot_id}/publish", True),
        ("GET", "/config/credit-period", False),
        ("POST", "/config/credit-period", False),
        ("GET", "/config/aliases", False),
        ("POST", "/config/aliases", False),
    ],
)
def test_unauthenticated_gets_401_not_403(
    client: TestClient,
    db_session: Session,
    rbac_resources: dict[str, Any],
    method: str,
    path_template: str,
    needs_resources: bool,
) -> None:
    """Unauthenticated requests return 401, confirming auth fires before role checks.

    For POST endpoints with required body fields (credit-period, aliases), a
    schema-valid dummy body is supplied so that FastAPI reaches the auth
    dependency rather than short-circuiting with 422 on body validation.
    """
    # Clear any session cookie left by rbac_resources fixture, then grab a
    # fresh CSRF cookie as an unauthenticated visitor.
    client.cookies.clear()
    client.get("/health")

    snapshot_id = (
        rbac_resources["snapshot_id"] if needs_resources else "00000000-0000-0000-0000-000000000000"
    )
    path = path_template.format(snapshot_id=snapshot_id)

    csrf_tok = _csrf(client)
    headers = {"X-CSRF-Token": csrf_tok} if csrf_tok else {}

    # Build a body that satisfies schema validation for endpoints that require
    # specific fields.  Auth fires after body parsing in FastAPI; without a
    # valid body the route returns 422 before reaching the auth dependency.
    dummy_uuid = "00000000-0000-0000-0000-000000000001"
    post_bodies: dict[str, dict[str, Any]] = {
        "/config/credit-period": {
            "canonical_id": dummy_uuid,
            "credit_days": 30,
            "valid_from": "2026-01-01",
        },
        "/config/aliases": {
            "canonical_id": dummy_uuid,
            "alias_text": "dummy-alias",
        },
    }

    if method == "GET":
        resp = client.get(path, headers=headers)
    elif method == "POST":
        body = post_bodies.get(path, {})
        resp = client.post(path, json=body, headers=headers)
    else:
        raise ValueError(f"Unexpected method: {method}")

    assert (
        resp.status_code == 401
    ), f"{method} {path}: expected 401, got {resp.status_code} {resp.text}"
