"""Unit tests for config_service.py with mocked DB (M3 Task 6).

Focuses on business logic:
- Credit period versioning (close-prior-on-new)
- RBAC + entity-scope checks
- Alias normalisation + UNIQUE check
- Pagination helpers
- Closed-row PATCH rejection
"""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import MagicMock

import pytest

from app.core.rbac import Role
from app.schemas.config import (
    AliasCreateRequest,
    CreditPeriodCreateRequest,
    CreditPeriodPatchRequest,
)
from app.services import config_service

# ---------------------------------------------------------------------------
# Helpers — build mock objects
# ---------------------------------------------------------------------------


def _mock_user(role: Role, entity_code: str | None = None) -> MagicMock:
    user = MagicMock()
    user.id = uuid.uuid4()
    user.email = f"{role.value.lower()}@emb.global"
    user.role = role
    if entity_code is not None:
        entity = MagicMock()
        entity.id = uuid.uuid4()
        entity.code = entity_code
        user.entity_id_scope = entity.id
        user._mock_entity = entity
    else:
        user.entity_id_scope = None
    return user


def _mock_entity(code: str = "IND") -> MagicMock:
    entity = MagicMock()
    entity.id = uuid.uuid4()
    entity.code = code
    return entity


def _mock_canonical(entity: MagicMock) -> MagicMock:
    canonical = MagicMock()
    canonical.id = uuid.uuid4()
    canonical.entity_id = entity.id
    canonical.name = "Test Canonical"
    return canonical


def _mock_db() -> MagicMock:
    return MagicMock()


# ---------------------------------------------------------------------------
# Test 1: _check_read_rbac — PENDING raises 403
# ---------------------------------------------------------------------------


def test_check_read_rbac_pending_raises_403() -> None:
    from fastapi import HTTPException

    user = _mock_user(Role.PENDING)
    with pytest.raises(HTTPException) as exc:
        config_service._check_read_rbac(user)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Test 2: _check_read_rbac — CFO does not raise
# ---------------------------------------------------------------------------


def test_check_read_rbac_cfo_ok() -> None:
    user = _mock_user(Role.CFO)
    config_service._check_read_rbac(user)  # should not raise


# ---------------------------------------------------------------------------
# Test 3: _check_write_rbac — CFO raises 403
# ---------------------------------------------------------------------------


def test_check_write_rbac_cfo_raises_403() -> None:
    from fastapi import HTTPException

    user = _mock_user(Role.CFO)
    with pytest.raises(HTTPException) as exc:
        config_service._check_write_rbac(user)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Test 4: _check_write_rbac — PENDING raises 403
# ---------------------------------------------------------------------------


def test_check_write_rbac_pending_raises_403() -> None:
    from fastapi import HTTPException

    user = _mock_user(Role.PENDING)
    with pytest.raises(HTTPException) as exc:
        config_service._check_write_rbac(user)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Test 5: _check_admin_only — analyst raises 403
# ---------------------------------------------------------------------------


def test_check_admin_only_analyst_raises_403() -> None:
    from fastapi import HTTPException

    user = _mock_user(Role.ANALYST)
    with pytest.raises(HTTPException) as exc:
        config_service._check_admin_only(user)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Test 6: _check_analyst_entity_scope — wrong entity raises 403
# ---------------------------------------------------------------------------


def test_check_analyst_entity_scope_wrong_entity_raises_403() -> None:
    from fastapi import HTTPException

    user = _mock_user(Role.ANALYST, entity_code="IND")
    other_entity_id = uuid.uuid4()  # different from user.entity_id_scope

    with pytest.raises(HTTPException) as exc:
        config_service._check_analyst_entity_scope(user, other_entity_id)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Test 7: _check_analyst_entity_scope — None scope (all entities) passes
# ---------------------------------------------------------------------------


def test_check_analyst_entity_scope_none_scope_passes() -> None:
    user = _mock_user(Role.ANALYST)
    user.entity_id_scope = None
    # Should not raise even for any entity_id
    config_service._check_analyst_entity_scope(user, uuid.uuid4())


# ---------------------------------------------------------------------------
# Test 8: _paginate helper — calculates pages correctly
# ---------------------------------------------------------------------------


def test_paginate_helper() -> None:
    meta = config_service._paginate(total=103, page=2, page_size=50)
    assert meta.page == 2
    assert meta.page_size == 50
    assert meta.total == 103
    assert meta.total_pages == 3


def test_paginate_helper_zero_total() -> None:
    meta = config_service._paginate(total=0, page=1, page_size=50)
    assert meta.total == 0
    assert meta.total_pages == 1  # at least 1


# ---------------------------------------------------------------------------
# Test 9: create_credit_period — 404 when canonical not found
# ---------------------------------------------------------------------------


def test_create_credit_period_canonical_not_found_404() -> None:
    from fastapi import HTTPException

    db = _mock_db()
    db.get.return_value = None  # canonical not found

    user = _mock_user(Role.ADMIN)
    body = CreditPeriodCreateRequest(
        canonical_id=uuid.uuid4(),
        credit_days=30,
        valid_from=date(2026, 1, 1),
    )

    with pytest.raises(HTTPException) as exc:
        config_service.create_credit_period(db=db, body=body, current_user=user)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Test 10: patch_credit_period — 409 when row is closed
# ---------------------------------------------------------------------------


def test_patch_credit_period_closed_row_raises_409() -> None:
    from fastapi import HTTPException

    db = _mock_db()
    admin = _mock_user(Role.ADMIN)

    cfg = MagicMock()
    cfg.valid_to = date(2026, 6, 30)  # row is CLOSED
    cfg.id = uuid.uuid4()
    db.get.return_value = cfg

    body = CreditPeriodPatchRequest(credit_days=45)

    with pytest.raises(HTTPException) as exc:
        config_service.patch_credit_period(db=db, config_id=cfg.id, body=body, current_user=admin)
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "CREDIT_PERIOD_ROW_CLOSED"


# ---------------------------------------------------------------------------
# Test 11: create_alias — normalises alias_text (strips whitespace)
# ---------------------------------------------------------------------------


def test_create_alias_empty_after_strip_raises_422() -> None:
    from fastapi import HTTPException

    db = _mock_db()
    entity = _mock_entity("IND")
    canonical = _mock_canonical(entity)
    db.get.side_effect = lambda model, pk: (
        canonical if model.__name__ == "PartyCanonical" else entity
    )

    admin = _mock_user(Role.ADMIN)
    body = AliasCreateRequest(canonical_id=canonical.id, alias_text="   ")  # whitespace only

    with pytest.raises(HTTPException) as exc:
        config_service.create_alias(db=db, body=body, current_user=admin)
    assert exc.value.status_code == 422
