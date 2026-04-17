"""Unit tests for app.services.staging_service (M3 Task 4).

Focuses on:
- _build_effective_overrides: latest-wins semantics
- _compute_publish_gate: all gate conditions
- _effective_analyst_overrides_invoice: action → override derivation
- _filter_invoice_rows: each filter mode
- _build_invoice_row / _build_cp_row: shape correctness

Uses MagicMock + synthetic data — no live DB.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import MagicMock

from app.core.rbac import Role
from app.services.alias_resolver import AliasCandidate, AliasResolution
from app.services.staging_service import (
    _build_cp_row,
    _build_effective_overrides,
    _build_invoice_row,
    _compute_publish_gate,
    _effective_analyst_overrides_invoice,
    _filter_invoice_rows,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(role: Role = Role.ANALYST, entity_id: uuid.UUID | None = None) -> MagicMock:
    user = MagicMock()
    user.role = role
    user.entity_id_scope = entity_id
    user.id = uuid.uuid4()
    return user


def _make_resolution(state: str = "EXACT", raw_name: str = "TestParty") -> AliasResolution:
    cid = uuid.uuid4()
    return AliasResolution(
        raw_name=raw_name,
        resolution_state=state,  # type: ignore[arg-type]
        top_matches=(
            [
                AliasCandidate(
                    canonical_id=cid,
                    canonical_name="TestParty Canonical",
                    matched_on="CANONICAL_NAME",
                    matched_text="TestParty Canonical",
                    ratio=95 if state != "EXACT" else 100,
                    is_exact=(state == "EXACT"),
                )
            ]
            if state != "UNMAPPED"
            else []
        ),
    )


def _make_invoice(
    row_index: int = 0,
    status: str = "OK",
    party_name_raw: str = "TestParty",
) -> dict[str, Any]:
    return {
        "row_index": row_index,
        "status": status,
        "party_name_raw": party_name_raw,
        "invoice_ref": f"INV-{row_index:03d}",
        "invoice_date": "2026-01-15",
        "amount": "1000.00",
        "source_currency": "INR",
        "parse_error_reason": "bad row" if status == "PARSE_ERROR" else None,
        "raw_row_json": {"ref": f"INV-{row_index:03d}"},
        "xero_metadata": None,
    }


# ---------------------------------------------------------------------------
# _build_effective_overrides
# ---------------------------------------------------------------------------


class TestBuildEffectiveOverrides:
    def test_empty_list_returns_empty_dict(self) -> None:
        assert _build_effective_overrides([]) == {}

    def test_single_entry(self) -> None:
        entry = {
            "row_index": 0,
            "action": "resolve_alias",
            "payload": {},
            "actor_user_id": "x",
            "ts": "t",
        }
        result = _build_effective_overrides([entry])
        assert result == {0: entry}

    def test_latest_wins_same_row_index(self) -> None:
        e1 = {
            "row_index": 0,
            "action": "dismiss_parse_error",
            "payload": {},
            "actor_user_id": "x",
            "ts": "t1",
        }
        e2 = {
            "row_index": 0,
            "action": "undismiss_parse_error",
            "payload": {},
            "actor_user_id": "x",
            "ts": "t2",
        }
        result = _build_effective_overrides([e1, e2])
        assert result[0]["action"] == "undismiss_parse_error"

    def test_multiple_rows_independent(self) -> None:
        e0 = {
            "row_index": 0,
            "action": "resolve_alias",
            "payload": {},
            "actor_user_id": "x",
            "ts": "t",
        }
        e1 = {
            "row_index": 1,
            "action": "dismiss_parse_error",
            "payload": {},
            "actor_user_id": "x",
            "ts": "t",
        }
        result = _build_effective_overrides([e0, e1])
        assert result[0]["action"] == "resolve_alias"
        assert result[1]["action"] == "dismiss_parse_error"


# ---------------------------------------------------------------------------
# _effective_analyst_overrides_invoice
# ---------------------------------------------------------------------------


class TestEffectiveAnalystOverrides:
    def test_no_override(self) -> None:
        overrides = _effective_analyst_overrides_invoice(0, {})
        assert overrides.resolved_canonical_id is None
        assert overrides.dismissed is False
        assert overrides.credit_days_override is None

    def test_resolve_alias(self) -> None:
        cid = uuid.uuid4()
        entry = {
            "row_index": 0,
            "action": "resolve_alias",
            "payload": {"canonical_id": str(cid)},
            "actor_user_id": "x",
            "ts": "t",
        }
        overrides = _effective_analyst_overrides_invoice(0, {0: entry})
        assert overrides.resolved_canonical_id == cid

    def test_override_credit_days(self) -> None:
        entry = {
            "row_index": 0,
            "action": "override_credit_days",
            "payload": {"credit_days": 45, "reason": ""},
            "actor_user_id": "x",
            "ts": "t",
        }
        overrides = _effective_analyst_overrides_invoice(0, {0: entry})
        assert overrides.credit_days_override == 45
        assert overrides.credit_days_source == "MANUAL"

    def test_dismiss(self) -> None:
        entry = {
            "row_index": 0,
            "action": "dismiss_parse_error",
            "payload": {"reason": "ok"},
            "actor_user_id": "x",
            "ts": "t",
        }
        overrides = _effective_analyst_overrides_invoice(0, {0: entry})
        assert overrides.dismissed is True

    def test_undismiss(self) -> None:
        entry = {
            "row_index": 0,
            "action": "undismiss_parse_error",
            "payload": {},
            "actor_user_id": "x",
            "ts": "t",
        }
        overrides = _effective_analyst_overrides_invoice(0, {0: entry})
        assert overrides.dismissed is False


# ---------------------------------------------------------------------------
# _compute_publish_gate
# ---------------------------------------------------------------------------


class TestComputePublishGate:
    def _exact_resolutions(self, invoice_rows: list[dict[str, Any]]) -> dict[str, AliasResolution]:
        return {
            inv["party_name_raw"]: _make_resolution("EXACT", inv["party_name_raw"])
            for inv in invoice_rows
        }

    def test_all_ok_no_overrides_exact_resolutions(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)
        invs = [_make_invoice(0, "OK", "Alpha"), _make_invoice(1, "OK", "Beta")]
        resolutions = self._exact_resolutions(invs)

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=invs,
            cp_rows_all=[],
            resolutions_by_raw=resolutions,
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.ok is True
        assert gate.unmapped_parties_count == 0
        assert gate.parse_errors_unresolved_count == 0
        assert gate.warnings_unacknowledged == []
        assert gate.role_permits_publish is True

    def test_unmapped_row_blocks_gate(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)
        invs = [_make_invoice(0, "OK", "UnknownParty")]
        resolutions = {"UnknownParty": _make_resolution("UNMAPPED", "UnknownParty")}

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=invs,
            cp_rows_all=[],
            resolutions_by_raw=resolutions,
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.ok is False
        assert gate.unmapped_parties_count == 1
        assert gate.fuzzy_high_pending_count == 0

    def test_fuzzy_high_counted_in_both_unmapped_and_fuzzy_high(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)
        invs = [_make_invoice(0, "OK", "AlmostMatch")]
        resolutions = {"AlmostMatch": _make_resolution("FUZZY_HIGH", "AlmostMatch")}

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=invs,
            cp_rows_all=[],
            resolutions_by_raw=resolutions,
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.unmapped_parties_count == 1
        assert gate.fuzzy_high_pending_count == 1

    def test_resolved_alias_removes_from_unmapped(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)
        invs = [_make_invoice(0, "OK", "UnknownParty")]
        resolutions = {"UnknownParty": _make_resolution("UNMAPPED", "UnknownParty")}
        cid = uuid.uuid4()
        overrides = {
            0: {
                "row_index": 0,
                "action": "resolve_alias",
                "payload": {"canonical_id": str(cid)},
                "actor_user_id": "x",
                "ts": "t",
            }
        }

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=invs,
            cp_rows_all=[],
            resolutions_by_raw=resolutions,
            overrides_by_row=overrides,
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.ok is True
        assert gate.unmapped_parties_count == 0

    def test_parse_error_unresolved_blocks_gate(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)
        invs = [_make_invoice(0, "PARSE_ERROR", "BadRow")]

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=invs,
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.ok is False
        assert gate.parse_errors_unresolved_count == 1

    def test_dismissed_parse_error_does_not_block(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)
        invs = [_make_invoice(0, "PARSE_ERROR", "BadRow")]
        overrides = {
            0: {
                "row_index": 0,
                "action": "dismiss_parse_error",
                "payload": {"reason": "ok"},
                "actor_user_id": "x",
                "ts": "t",
            }
        }

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=invs,
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row=overrides,
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.parse_errors_unresolved_count == 0

    def test_unacknowledged_warning_blocks_gate(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=[],
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row={},
            warnings_all=[
                {"code": "GRAND_TOTAL_MISMATCH", "message": "x", "detail": None, "row_index": -1}
            ],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.ok is False
        assert "GRAND_TOTAL_MISMATCH" in gate.warnings_unacknowledged

    def test_acknowledged_warning_clears_gate(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, entity_id)

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=[],
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row={},
            warnings_all=[
                {"code": "GRAND_TOTAL_MISMATCH", "message": "x", "detail": None, "row_index": -1}
            ],
            warnings_acknowledged_json=[
                {"code": "GRAND_TOTAL_MISMATCH", "ack_by": "x", "ack_at": "t"}
            ],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.warnings_unacknowledged == []

    def test_cfo_role_does_not_permit_publish(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.CFO)

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=[],
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.role_permits_publish is False
        assert gate.ok is False

    def test_admin_permits_publish_any_entity(self) -> None:
        entity_id = uuid.uuid4()
        user = _make_user(Role.ADMIN)
        user.entity_id_scope = None

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=[],
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.role_permits_publish is True

    def test_analyst_wrong_entity_does_not_permit(self) -> None:
        entity_id = uuid.uuid4()
        other_entity_id = uuid.uuid4()
        user = _make_user(Role.ANALYST, other_entity_id)

        gate = _compute_publish_gate(
            source_hint="TALLY",
            invoice_rows_all=[],
            cp_rows_all=[],
            resolutions_by_raw={},
            overrides_by_row={},
            warnings_all=[],
            warnings_acknowledged_json=[],
            current_user=user,
            snapshot_entity_id=entity_id,
        )
        assert gate.role_permits_publish is False


# ---------------------------------------------------------------------------
# _filter_invoice_rows
# ---------------------------------------------------------------------------


class TestFilterInvoiceRows:
    def _resolutions(
        self, rows: list[dict[str, Any]], state: str = "EXACT"
    ) -> dict[str, AliasResolution]:
        return {r["party_name_raw"]: _make_resolution(state, r["party_name_raw"]) for r in rows}

    def test_filter_all_returns_everything(self) -> None:
        rows = [_make_invoice(0, "OK"), _make_invoice(1, "PARSE_ERROR")]
        result = _filter_invoice_rows(rows, "all", {}, {})
        assert len(result) == 2

    def test_filter_ok(self) -> None:
        rows = [_make_invoice(0, "OK"), _make_invoice(1, "PARSE_ERROR")]
        result = _filter_invoice_rows(rows, "ok", {}, {})
        assert len(result) == 1
        assert result[0]["row_index"] == 0

    def test_filter_parse_error(self) -> None:
        rows = [_make_invoice(0, "OK"), _make_invoice(1, "PARSE_ERROR")]
        result = _filter_invoice_rows(rows, "parse_error", {}, {})
        assert len(result) == 1
        assert result[0]["row_index"] == 1

    def test_filter_unmapped(self) -> None:
        rows = [_make_invoice(0, "OK", "Alpha"), _make_invoice(1, "OK", "Beta")]
        resolutions = {
            "Alpha": _make_resolution("UNMAPPED", "Alpha"),
            "Beta": _make_resolution("EXACT", "Beta"),
        }
        result = _filter_invoice_rows(rows, "unmapped", resolutions, {})
        assert len(result) == 1
        assert result[0]["party_name_raw"] == "Alpha"

    def test_filter_unmapped_excludes_resolved(self) -> None:
        rows = [_make_invoice(0, "OK", "Alpha")]
        resolutions = {"Alpha": _make_resolution("UNMAPPED", "Alpha")}
        cid = uuid.uuid4()
        overrides = {
            0: {
                "row_index": 0,
                "action": "resolve_alias",
                "payload": {"canonical_id": str(cid)},
                "actor_user_id": "x",
                "ts": "t",
            }
        }
        result = _filter_invoice_rows(rows, "unmapped", resolutions, overrides)
        assert len(result) == 0

    def test_filter_fuzzy_high(self) -> None:
        rows = [_make_invoice(0, "OK", "AlmostMatch"), _make_invoice(1, "OK", "WeakMatch")]
        resolutions = {
            "AlmostMatch": _make_resolution("FUZZY_HIGH", "AlmostMatch"),
            "WeakMatch": _make_resolution("FUZZY_LOW", "WeakMatch"),
        }
        result = _filter_invoice_rows(rows, "fuzzy_high", resolutions, {})
        assert len(result) == 1
        assert result[0]["party_name_raw"] == "AlmostMatch"

    def test_filter_fuzzy_low(self) -> None:
        rows = [_make_invoice(0, "OK", "AlmostMatch"), _make_invoice(1, "OK", "WeakMatch")]
        resolutions = {
            "AlmostMatch": _make_resolution("FUZZY_HIGH", "AlmostMatch"),
            "WeakMatch": _make_resolution("FUZZY_LOW", "WeakMatch"),
        }
        result = _filter_invoice_rows(rows, "fuzzy_low", resolutions, {})
        assert len(result) == 1
        assert result[0]["party_name_raw"] == "WeakMatch"


# ---------------------------------------------------------------------------
# _build_invoice_row
# ---------------------------------------------------------------------------


class TestBuildInvoiceRow:
    def test_shape_ok_row(self) -> None:
        inv = _make_invoice(0, "OK", "Alpha")
        resolution = _make_resolution("EXACT", "Alpha")
        row = _build_invoice_row(inv, resolution, {})
        assert row.row_index == 0
        assert row.status == "OK"
        assert row.alias_resolution.resolution_state == "EXACT"
        assert row.analyst_overrides.dismissed is False

    def test_shape_parse_error_row(self) -> None:
        inv = _make_invoice(1, "PARSE_ERROR", "BadParty")
        resolution = _make_resolution("UNMAPPED", "BadParty")
        row = _build_invoice_row(inv, resolution, {})
        assert row.status == "PARSE_ERROR"
        assert row.parse_error_reason == "bad row"

    def test_overrides_applied(self) -> None:
        inv = _make_invoice(0, "OK", "Alpha")
        resolution = _make_resolution("EXACT", "Alpha")
        cid = uuid.uuid4()
        overrides = {
            0: {
                "row_index": 0,
                "action": "resolve_alias",
                "payload": {"canonical_id": str(cid)},
                "actor_user_id": "x",
                "ts": "t",
            }
        }
        row = _build_invoice_row(inv, resolution, overrides)
        assert row.analyst_overrides.resolved_canonical_id == cid


# ---------------------------------------------------------------------------
# _build_cp_row
# ---------------------------------------------------------------------------


class TestBuildCpRow:
    def test_shape(self) -> None:
        cp = {
            "row_index": 0,
            "entity_code": "IND",
            "name": "AlphaClient Ltd",
            "credit_days": 30,
            "reason_note": None,
        }
        row = _build_cp_row(cp, {})
        assert row.row_index == 0
        assert row.entity_code == "IND"
        assert row.credit_days == 30
        assert row.analyst_overrides.dismissed is False

    def test_with_dismiss_override(self) -> None:
        cp = {
            "row_index": 2,
            "entity_code": "UAE",
            "name": "BetaClient LLC",
            "credit_days": 45,
            "reason_note": "contract",
        }
        overrides = {
            2: {
                "row_index": 2,
                "action": "dismiss_parse_error",
                "payload": {},
                "actor_user_id": "x",
                "ts": "t",
            }
        }
        row = _build_cp_row(cp, overrides)
        assert row.analyst_overrides.dismissed is True
