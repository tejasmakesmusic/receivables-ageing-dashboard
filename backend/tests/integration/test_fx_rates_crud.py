"""Integration tests for GET/POST /config/fx-rates (M6 Group E).

Immutability (D15):
  - POST creates a new row — never updates an existing one.
  - PATCH /config/fx-rates/:id → 405
  - DELETE /config/fx-rates/:id → 405

RBAC: ADMIN only for POST; all logged-in roles for GET.
"""

from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from app.core.rbac import Role
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


def _login_as_cfo(client: TestClient, db_session: Session, email: str = "cfo@emb.global") -> None:
    _login(client, email)
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    user.role = Role.CFO
    user.is_active = True
    db_session.flush()


def _headers(client: TestClient) -> dict[str, str]:
    t = _csrf(client)
    return {"X-CSRF-Token": t} if t else {}


def _post_rate(
    client: TestClient,
    from_ccy: str = "AED",
    to_ccy: str = "INR",
    rate: float = 22.5,
    valid_from: str = "2026-01-01",
    source: str = "MANUAL",
) -> Any:
    return client.post(
        "/config/fx-rates",
        json={
            "from_ccy": from_ccy,
            "to_ccy": to_ccy,
            "rate": str(rate),
            "valid_from": valid_from,
            "source": source,
        },
        headers=_headers(client),
    )


# ---------------------------------------------------------------------------
# POST /config/fx-rates
# ---------------------------------------------------------------------------


def test_post_fx_rate_201_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = _post_rate(client, valid_from="2026-01-01")
    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["from_ccy"] == "AED"
    assert body["to_ccy"] == "INR"
    assert Decimal(str(body["rate"])) == Decimal("22.5")
    assert body["valid_from"] == "2026-01-01"
    assert body["id"] is not None


def test_post_fx_rate_duplicate_409(client: TestClient, db_session: Session) -> None:
    """Same (from_ccy, to_ccy, valid_from) → 409."""
    _login_as_admin(client)
    _post_rate(client, from_ccy="AED", to_ccy="INR", valid_from="2026-02-01")
    resp = _post_rate(client, from_ccy="AED", to_ccy="INR", valid_from="2026-02-01")
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "FX_RATE_DUPLICATE"


def test_post_fx_rate_analyst_403(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = _post_rate(client, valid_from="2026-03-01")
    assert resp.status_code == 403


def test_post_fx_rate_cfo_403(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = _post_rate(client, valid_from="2026-03-01")
    assert resp.status_code == 403


def test_post_fx_rate_rate_must_be_positive(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.post(
        "/config/fx-rates",
        json={"from_ccy": "AED", "to_ccy": "INR", "rate": "-1", "valid_from": "2026-01-01"},
        headers=_headers(client),
    )
    assert resp.status_code == 422


def test_post_fx_rate_ccy_must_be_3_chars(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = client.post(
        "/config/fx-rates",
        json={"from_ccy": "AE", "to_ccy": "INR", "rate": "22.5", "valid_from": "2026-01-01"},
        headers=_headers(client),
    )
    assert resp.status_code == 422


def test_post_fx_rate_writes_audit_log(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    from app.db.models.audit_log import AuditLog

    before_count = db_session.query(AuditLog).filter(AuditLog.action == "fx_rate.create").count()
    _post_rate(client, from_ccy="AED", to_ccy="INR", valid_from="2026-05-01")
    after_count = db_session.query(AuditLog).filter(AuditLog.action == "fx_rate.create").count()
    assert after_count == before_count + 1


# ---------------------------------------------------------------------------
# GET /config/fx-rates
# ---------------------------------------------------------------------------


def _seed_rate(
    client: TestClient,
    valid_from: str,
    from_ccy: str = "AED",
    to_ccy: str = "INR",
    rate: float = 22.5,
) -> None:
    _post_rate(client, from_ccy=from_ccy, to_ccy=to_ccy, rate=rate, valid_from=valid_from)


def test_get_fx_rates_200_admin(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_rate(client, "2026-01-15")
    resp = client.get("/config/fx-rates")
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert isinstance(body["items"], list)


def test_get_fx_rates_200_analyst(client: TestClient, db_session: Session) -> None:
    _login_as_analyst(client, db_session, "analyst@emb.global")
    resp = client.get("/config/fx-rates")
    assert resp.status_code == 200


def test_get_fx_rates_200_cfo(client: TestClient, db_session: Session) -> None:
    _login_as_cfo(client, db_session, "cfo@emb.global")
    resp = client.get("/config/fx-rates")
    assert resp.status_code == 200


def test_get_fx_rates_filter_by_from_ccy(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_rate(client, "2026-01-16", from_ccy="AED", to_ccy="INR")
    _seed_rate(client, "2026-01-17", from_ccy="USD", to_ccy="INR")

    resp = client.get("/config/fx-rates?from_ccy=USD")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["from_ccy"] == "USD" for i in items)


def test_get_fx_rates_filter_by_to_ccy(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    _seed_rate(client, "2026-01-18", to_ccy="INR")
    resp = client.get("/config/fx-rates?to_ccy=INR")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all(i["to_ccy"] == "INR" for i in items)


# ---------------------------------------------------------------------------
# PATCH /config/fx-rates/:id → 405 (immutability D15)
# ---------------------------------------------------------------------------


def test_patch_fx_rate_405(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = _post_rate(client, valid_from="2026-04-01")
    assert resp.status_code == 201
    rate_id = resp.json()["id"]

    resp2 = client.patch(
        f"/config/fx-rates/{rate_id}",
        json={"rate": "25.0"},
        headers=_headers(client),
    )
    assert resp2.status_code == 405


def test_delete_fx_rate_405(client: TestClient, db_session: Session) -> None:
    _login_as_admin(client)
    resp = _post_rate(client, valid_from="2026-04-02")
    assert resp.status_code == 201
    rate_id = resp.json()["id"]

    resp2 = client.delete(
        f"/config/fx-rates/{rate_id}",
        headers=_headers(client),
    )
    assert resp2.status_code == 405
