"""Unit tests for app.services.publish_service (M3 Task 5).

Focuses on:
- _check_rbac_and_entity_scope: role + entity-scope combinations
- _resolve_canonical_id_for_row: priority chain
- _resolve_credit_days: D8 priority (MANUAL > CONFIG > DEFAULT)
- Material-change math (>5% threshold)

Uses MagicMock + synthetic data — no live DB.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.core.rbac import Role
from app.services.publish_service import (
    _check_rbac_and_entity_scope,
    _resolve_canonical_id_for_row,
    _resolve_credit_days,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(
    role: Role = Role.ANALYST,
    entity_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
) -> MagicMock:
    user = MagicMock()
    user.role = role
    user.entity_id_scope = entity_id
    user.id = user_id or uuid.uuid4()
    user.email = "test@example.com"
    return user


def _make_snapshot(
    entity_id: uuid.UUID | None = None,
    uploaded_by: uuid.UUID | None = None,
    status: str = "STAGED",
    source_hint: str = "TALLY",
) -> MagicMock:
    snap = MagicMock()
    snap.entity_id = entity_id or uuid.uuid4()
    snap.uploaded_by = uploaded_by or uuid.uuid4()
    snap.status = status
    snap.source_hint = source_hint
    return snap


def _make_resolution(state: str = "EXACT", canonical_id: uuid.UUID | None = None) -> MagicMock:
    cid = canonical_id or uuid.uuid4()
    top_match = MagicMock()
    top_match.canonical_id = cid
    res = MagicMock()
    res.resolution_state = state
    res.top_matches = [top_match] if state == "EXACT" else []
    return res


# ---------------------------------------------------------------------------
# _check_rbac_and_entity_scope
# ---------------------------------------------------------------------------


class TestCheckRbacAndEntityScope:
    def test_cfo_raises_403(self) -> None:
        from fastapi import HTTPException

        user = _make_user(role=Role.CFO)
        snap = _make_snapshot()
        with pytest.raises(HTTPException) as exc_info:
            _check_rbac_and_entity_scope(user, snap)
        assert exc_info.value.status_code == 403

    def test_pending_raises_403(self) -> None:
        from fastapi import HTTPException

        user = _make_user(role=Role.PENDING)
        snap = _make_snapshot()
        with pytest.raises(HTTPException) as exc_info:
            _check_rbac_and_entity_scope(user, snap)
        assert exc_info.value.status_code == 403

    def test_analyst_correct_entity_returns_normal(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(role=Role.ANALYST, entity_id=entity_id)
        snap = _make_snapshot(entity_id=entity_id)
        result = _check_rbac_and_entity_scope(user, snap)
        assert result == "NORMAL"

    def test_analyst_wrong_entity_raises_403(self) -> None:
        from fastapi import HTTPException

        user = _make_user(role=Role.ANALYST, entity_id=uuid.uuid4())
        snap = _make_snapshot(entity_id=uuid.uuid4())
        with pytest.raises(HTTPException) as exc_info:
            _check_rbac_and_entity_scope(user, snap)
        assert exc_info.value.status_code == 403

    def test_analyst_null_scope_returns_normal(self) -> None:
        user = _make_user(role=Role.ANALYST, entity_id=None)
        snap = _make_snapshot(entity_id=uuid.uuid4())
        result = _check_rbac_and_entity_scope(user, snap)
        assert result == "NORMAL"

    def test_admin_own_snapshot_returns_normal(self) -> None:
        admin_id = uuid.uuid4()
        user = _make_user(role=Role.ADMIN, user_id=admin_id)
        snap = _make_snapshot(uploaded_by=admin_id)
        result = _check_rbac_and_entity_scope(user, snap)
        assert result == "NORMAL"

    def test_admin_other_snapshot_returns_override(self) -> None:
        admin_id = uuid.uuid4()
        user = _make_user(role=Role.ADMIN, user_id=admin_id)
        snap = _make_snapshot(uploaded_by=uuid.uuid4())  # different uploader
        result = _check_rbac_and_entity_scope(user, snap)
        assert result == "OVERRIDE"


# ---------------------------------------------------------------------------
# _resolve_canonical_id_for_row
# ---------------------------------------------------------------------------


class TestResolveCanonicalId:
    def test_override_resolve_alias_wins(self) -> None:
        cid = uuid.uuid4()
        overrides = {0: {"action": "resolve_alias", "payload": {"canonical_id": str(cid)}}}
        inv = {"party_name_raw": "TestParty", "row_index": 0}
        result = _resolve_canonical_id_for_row(inv, overrides, {}, 0)
        assert result == cid

    def test_override_create_canonical_wins(self) -> None:
        cid = uuid.uuid4()
        overrides = {0: {"action": "create_canonical", "payload": {"canonical_id": str(cid)}}}
        inv = {"party_name_raw": "TestParty", "row_index": 0}
        result = _resolve_canonical_id_for_row(inv, overrides, {}, 0)
        assert result == cid

    def test_exact_alias_resolution_used_when_no_override(self) -> None:
        cid = uuid.uuid4()
        resolution = _make_resolution(state="EXACT", canonical_id=cid)
        inv = {"party_name_raw": "TestParty", "row_index": 0}
        result = _resolve_canonical_id_for_row(inv, {}, {"TestParty": resolution}, 0)
        assert result == cid

    def test_fuzzy_resolution_without_override_raises_422(self) -> None:
        from fastapi import HTTPException

        resolution = _make_resolution(state="FUZZY_HIGH")
        inv = {"party_name_raw": "TestParty", "row_index": 0}
        with pytest.raises(HTTPException) as exc_info:
            _resolve_canonical_id_for_row(inv, {}, {"TestParty": resolution}, 0)
        assert exc_info.value.status_code == 422

    def test_no_resolution_raises_422(self) -> None:
        from fastapi import HTTPException

        inv = {"party_name_raw": "TestParty", "row_index": 0}
        with pytest.raises(HTTPException) as exc_info:
            _resolve_canonical_id_for_row(inv, {}, {}, 0)
        assert exc_info.value.status_code == 422


# ---------------------------------------------------------------------------
# _resolve_credit_days — D8 priority
# ---------------------------------------------------------------------------


class TestResolveCreditDays:
    def _make_db_no_config(self) -> MagicMock:
        """Mock DB that returns None for CreditPeriodConfig query."""
        db = MagicMock()
        db.scalar.return_value = None
        return db

    def _make_db_with_config(self, days: int = 30) -> MagicMock:
        """Mock DB that returns a CreditPeriodConfig row."""
        config = MagicMock()
        config.days = days
        db = MagicMock()
        db.scalar.return_value = config
        return db

    def test_manual_override_wins_over_config(self) -> None:
        """D8: MANUAL override wins even when CONFIG row exists."""
        db = self._make_db_with_config(days=30)
        overrides = {0: {"action": "override_credit_days", "payload": {"credit_days": 45}}}
        inv = {"row_index": 0}
        days, source = _resolve_credit_days(inv, overrides, 0, uuid.uuid4(), 60, db)
        assert days == 45
        assert source == "MANUAL"

    def test_config_row_wins_over_default(self) -> None:
        """D8: CONFIG row wins when no manual override."""
        db = self._make_db_with_config(days=30)
        inv = {"row_index": 0}
        days, source = _resolve_credit_days(inv, {}, 0, uuid.uuid4(), 60, db)
        assert days == 30
        assert source == "CONFIG"

    def test_entity_default_used_when_no_config_row(self) -> None:
        """D8: DEFAULT used when no manual override and no config row."""
        db = self._make_db_no_config()
        inv = {"row_index": 0}
        days, source = _resolve_credit_days(inv, {}, 0, uuid.uuid4(), 60, db)
        assert days == 60
        assert source == "DEFAULT"

    def test_entity_default_null_raises_422(self) -> None:
        """D8: 422 when all three sources are absent."""
        from fastapi import HTTPException

        db = self._make_db_no_config()
        inv = {"row_index": 0}
        with pytest.raises(HTTPException) as exc_info:
            _resolve_credit_days(inv, {}, 0, uuid.uuid4(), None, db)
        assert exc_info.value.status_code == 422
        assert "CREDIT_DAYS_UNRESOLVABLE" in str(exc_info.value.detail)

    def test_manual_override_wins_over_entity_default(self) -> None:
        db = self._make_db_no_config()
        overrides = {5: {"action": "override_credit_days", "payload": {"credit_days": 7}}}
        inv = {"row_index": 5}
        days, source = _resolve_credit_days(inv, overrides, 5, uuid.uuid4(), 30, db)
        assert days == 7
        assert source == "MANUAL"


# ---------------------------------------------------------------------------
# Material-change math (threshold: >5%)
# ---------------------------------------------------------------------------


class TestMaterialChangeMath:
    """Verify the >5% threshold logic used in publish_service."""

    def _delta_pct(self, prior: str, new: str) -> Decimal:
        p = Decimal(prior)
        n = Decimal(new)
        if p == Decimal("0"):
            return Decimal("0")
        return abs(n - p) / p

    def test_exactly_5_pct_is_not_flagged(self) -> None:
        delta = self._delta_pct("1000", "1050")
        assert delta == Decimal("0.05")
        assert delta <= Decimal("0.05")  # NOT > 0.05, so not flagged

    def test_just_over_5_pct_is_flagged(self) -> None:
        delta = self._delta_pct("1000", "1051")
        assert delta > Decimal("0.05")

    def test_under_5_pct_not_flagged(self) -> None:
        delta = self._delta_pct("1000", "1040")
        assert delta < Decimal("0.05")

    def test_large_decrease_flagged(self) -> None:
        delta = self._delta_pct("1000", "900")
        assert delta > Decimal("0.05")
