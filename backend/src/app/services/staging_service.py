"""Staging review service — GET builder and PATCH dispatcher (M3 Task 4).

Public interface::

    get_staging_view(
        db, snapshot_id, current_user,
        offset, limit, filter_mode,
    ) -> StagingViewResponse

    patch_staging_row(
        db, snapshot_id, row_index, body, current_user,
    ) -> StagingPatchResponse

    ack_warnings(
        db, snapshot_id, codes, current_user,
    ) -> WarningsAckResponse

Design notes:
- parse_result_json is NEVER rewritten — it is the immutable parser output.
- staging_overrides_json is append-only.  Latest-wins per row_index.
- Alias resolution is computed at read-time via resolve_aliases_batch; not
  persisted on the snapshot row.  This means the reviewer always sees the
  latest alias master state.
- SELECT FOR UPDATE is used on snapshot row during PATCH to serialise
  concurrent appends (prevents lost-write races).
- No DB writes on GET endpoints (CLAUDE.md guardrail).
- No raw party names / invoice refs in structlog (CLAUDE.md guardrail).
- datetime.now(tz=timezone.utc) used only for audit_log / override timestamp
  fields; never for ageing calc.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.snapshot import Snapshot
from app.schemas.staging import (
    AnalystOverridesCreditPeriod,
    AnalystOverridesInvoice,
    PaginationMeta,
    PublishGate,
    SnapshotNotStagedError,
    StagingCreditPeriodRow,
    StagingInvoiceRow,
    StagingPatchResponse,
    StagingTotals,
    StagingViewResponse,
    WarningsAckResponse,
)
from app.services.alias_resolver import AliasResolution, resolve_aliases_batch

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User
    from app.schemas.staging import StagingPatchRequest

log = structlog.get_logger(__name__)

# Allowed filter values.
FilterMode = Literal["all", "ok", "parse_error", "unmapped", "fuzzy_low", "fuzzy_high"]

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _require_staged(snapshot: Snapshot | None, snapshot_id: uuid.UUID) -> Snapshot:
    """Raise 404 if snapshot not found, 409 if not STAGED."""
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found.")
    if snapshot.status != "STAGED":
        raise HTTPException(
            status_code=409,
            detail=SnapshotNotStagedError(snapshot_status=snapshot.status).model_dump(),
        )
    return snapshot


def _check_entity_scope(current_user: User, snapshot: Snapshot, db: Session) -> None:
    """Raise 403 if ANALYST user's entity scope does not include snapshot's entity."""
    from app.core.rbac import Role

    if current_user.role == Role.ADMIN:
        return
    if current_user.role == Role.ANALYST:
        if (
            current_user.entity_id_scope is not None
            and current_user.entity_id_scope != snapshot.entity_id
        ):
            raise HTTPException(
                status_code=403,
                detail="Analyst scope does not include this entity.",
            )
        return
    # CFO, PENDING — denied
    raise HTTPException(status_code=403, detail="Insufficient permissions.")


def _get_entity_code(db: Session, entity_id: uuid.UUID) -> str:
    """Fetch entity.code for a given entity_id."""
    entity = db.scalar(select(Entity).where(Entity.id == entity_id))
    if entity is None:
        raise HTTPException(status_code=500, detail="Entity not found for snapshot.")
    return entity.code


def _get_uploader_email(snapshot: Snapshot) -> str:
    """Return the email of the uploading user."""
    return snapshot.uploader.email


def _build_effective_overrides(
    staging_overrides_json: list[dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """Reduce staging_overrides_json to a dict of {row_index → effective_override}.

    Latest-wins: iterate in order, last entry per row_index wins.
    O(n) over the overrides list; n <= 1000 * actions_per_row.
    """
    effective: dict[int, dict[str, Any]] = {}
    for entry in staging_overrides_json:
        row_idx: int = entry["row_index"]
        effective[row_idx] = entry
    return effective


def _effective_analyst_overrides_invoice(
    row_index: int,
    overrides_by_row: dict[int, dict[str, Any]],
) -> AnalystOverridesInvoice:
    """Derive AnalystOverridesInvoice from the effective override entry."""
    entry = overrides_by_row.get(row_index)
    if entry is None:
        return AnalystOverridesInvoice()

    action = entry.get("action")
    payload = entry.get("payload", {})

    if action in ("resolve_alias", "create_canonical"):
        canonical_id_str = payload.get("canonical_id")
        return AnalystOverridesInvoice(
            resolved_canonical_id=uuid.UUID(canonical_id_str) if canonical_id_str else None,
        )

    if action == "override_credit_days":
        credit_days = payload.get("credit_days")
        return AnalystOverridesInvoice(
            credit_days_override=credit_days,
            credit_days_source="MANUAL" if credit_days is not None else None,
        )

    if action == "dismiss_parse_error":
        return AnalystOverridesInvoice(dismissed=True)

    if action == "undismiss_parse_error":
        return AnalystOverridesInvoice(dismissed=False)

    return AnalystOverridesInvoice()


def _effective_analyst_overrides_cp(
    row_index: int,
    overrides_by_row: dict[int, dict[str, Any]],
) -> AnalystOverridesCreditPeriod:
    """Derive AnalystOverridesCreditPeriod from the effective override entry."""
    entry = overrides_by_row.get(row_index)
    if entry is None:
        return AnalystOverridesCreditPeriod()

    action = entry.get("action")
    payload = entry.get("payload", {})

    if action in ("resolve_alias", "create_canonical"):
        canonical_id_str = payload.get("canonical_id")
        return AnalystOverridesCreditPeriod(
            resolved_canonical_id=uuid.UUID(canonical_id_str) if canonical_id_str else None,
        )
    if action == "dismiss_parse_error":
        return AnalystOverridesCreditPeriod(dismissed=True)
    if action == "undismiss_parse_error":
        return AnalystOverridesCreditPeriod(dismissed=False)

    return AnalystOverridesCreditPeriod()


def _compute_publish_gate(
    source_hint: str,
    invoice_rows_all: list[dict[str, Any]],
    cp_rows_all: list[dict[str, Any]],
    resolutions_by_raw: dict[str, AliasResolution],
    overrides_by_row: dict[int, dict[str, Any]],
    warnings_all: list[dict[str, Any]],
    warnings_acknowledged_json: list[dict[str, Any]],
    current_user: User,
    snapshot_entity_id: uuid.UUID,
) -> PublishGate:
    """Compute the publish gate (spec §5 + task 4 rule #8).

    Rules:
    - unmapped_parties_count: OK invoice rows with no resolve_alias override
      AND live resolution != EXACT.
    - fuzzy_high_pending_count: subset of unmapped where state == FUZZY_HIGH.
    - parse_errors_unresolved_count: PARSE_ERROR rows without dismiss override.
    - warnings_unacknowledged: warning codes from parse_result_json.warnings
      not in warnings_acknowledged_json.
    - role_permits_publish: caller is ANALYST (entity-scoped match) or ADMIN.
    """
    from app.core.rbac import Role

    unmapped = 0
    fuzzy_high_pending = 0
    parse_errors_unresolved = 0

    for inv in invoice_rows_all:
        row_idx = inv["row_index"]
        status = inv.get("status", "OK")
        override = overrides_by_row.get(row_idx)
        effective_action = override.get("action") if override else None

        if status == "PARSE_ERROR":
            if effective_action != "dismiss_parse_error":
                parse_errors_unresolved += 1
        # Check if an alias has been resolved by the analyst
        elif effective_action not in ("resolve_alias", "create_canonical"):
            # Check live resolution state
            raw_name = inv.get("party_name_raw", "")
            resolution = resolutions_by_raw.get(raw_name)
            if resolution is None or resolution.resolution_state != "EXACT":
                unmapped += 1
                if resolution and resolution.resolution_state == "FUZZY_HIGH":
                    fuzzy_high_pending += 1

    # Warning acknowledgement
    acked_codes = {entry.get("code") for entry in warnings_acknowledged_json}
    warning_codes_all = [w.get("code", "") for w in warnings_all]
    unacked = [c for c in warning_codes_all if c not in acked_codes]

    # Role check
    role_permits = False
    if (
        current_user.role == Role.ADMIN
        or current_user.role == Role.ANALYST
        and (
            current_user.entity_id_scope is None
            or current_user.entity_id_scope == snapshot_entity_id
        )
    ):
        role_permits = True

    ok = unmapped == 0 and parse_errors_unresolved == 0 and len(unacked) == 0 and role_permits

    return PublishGate(
        ok=ok,
        unmapped_parties_count=unmapped,
        fuzzy_high_pending_count=fuzzy_high_pending,
        parse_errors_unresolved_count=parse_errors_unresolved,
        warnings_unacknowledged=unacked,
        role_permits_publish=role_permits,
    )


def _filter_invoice_rows(  # noqa: PLR0912
    invoice_rows: list[dict[str, Any]],
    filter_mode: FilterMode,
    resolutions_by_raw: dict[str, AliasResolution],
    overrides_by_row: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Apply filter to invoice rows list."""
    if filter_mode == "all":
        return invoice_rows

    result = []
    for inv in invoice_rows:
        status = inv.get("status", "OK")
        row_idx = inv["row_index"]
        override = overrides_by_row.get(row_idx)
        effective_action = override.get("action") if override else None
        unresolved = effective_action not in ("resolve_alias", "create_canonical")

        if filter_mode == "ok":
            if status == "OK":
                result.append(inv)
        elif filter_mode == "parse_error":
            if status == "PARSE_ERROR":
                result.append(inv)
        elif filter_mode == "unmapped":
            if status == "OK" and unresolved:
                raw_name = inv.get("party_name_raw", "")
                resolution = resolutions_by_raw.get(raw_name)
                if resolution is None or resolution.resolution_state != "EXACT":
                    result.append(inv)
        elif filter_mode == "fuzzy_low":
            if status == "OK" and unresolved:
                raw_name = inv.get("party_name_raw", "")
                resolution = resolutions_by_raw.get(raw_name)
                if resolution and resolution.resolution_state == "FUZZY_LOW":
                    result.append(inv)
        elif filter_mode == "fuzzy_high" and status == "OK" and unresolved:
            raw_name = inv.get("party_name_raw", "")
            resolution = resolutions_by_raw.get(raw_name)
            if resolution and resolution.resolution_state == "FUZZY_HIGH":
                result.append(inv)

    return result


def _build_invoice_row(
    inv: dict[str, Any],
    resolution: AliasResolution,
    overrides_by_row: dict[int, dict[str, Any]],
) -> StagingInvoiceRow:
    """Build a StagingInvoiceRow from raw parse_result_json invoice dict."""
    row_idx = inv["row_index"]
    overrides = _effective_analyst_overrides_invoice(row_idx, overrides_by_row)
    return StagingInvoiceRow(
        row_index=row_idx,
        status=inv.get("status", "OK"),
        party_name_raw=inv.get("party_name_raw", ""),
        invoice_ref=inv.get("invoice_ref"),
        invoice_date=inv.get("invoice_date"),
        amount=inv.get("amount"),
        source_currency=inv.get("source_currency", "INR"),
        parse_error_reason=inv.get("parse_error_reason"),
        alias_resolution=resolution,
        analyst_overrides=overrides,
        xero_metadata=inv.get("xero_metadata"),
        raw_row_json=inv.get("raw_row_json", {}),
    )


def _build_cp_row(
    cp: dict[str, Any],
    overrides_by_row: dict[int, dict[str, Any]],
) -> StagingCreditPeriodRow:
    """Build a StagingCreditPeriodRow from parse_result_json credit_period dict."""
    row_idx = cp["row_index"]
    overrides = _effective_analyst_overrides_cp(row_idx, overrides_by_row)
    return StagingCreditPeriodRow(
        row_index=row_idx,
        entity_code=cp.get("entity_code", "IND"),
        name=cp.get("name", ""),
        credit_days=cp.get("credit_days", 0),
        reason_note=cp.get("reason_note"),
        analyst_overrides=overrides,
    )


def _append_override(
    db: Session,
    snapshot: Snapshot,
    row_index: int,
    action: str,
    payload: dict[str, Any],
    actor_user_id: uuid.UUID,
) -> None:
    """Append one entry to staging_overrides_json, with audit log.

    Uses the in-memory snapshot object (already locked via SELECT FOR UPDATE
    by the caller).  The full list is reassigned to trigger SQLAlchemy's
    change-tracking on the JSONB column.
    """
    ts = datetime.now(tz=UTC).isoformat()
    entry: dict[str, Any] = {
        "row_index": row_index,
        "action": action,
        "payload": payload,
        "actor_user_id": str(actor_user_id),
        "ts": ts,
    }
    # Reassign to trigger SQLAlchemy dirty tracking on the JSONB column.
    current: list[Any] = list(snapshot.staging_overrides_json or [])
    current.append(entry)
    snapshot.staging_overrides_json = current

    audit = AuditLog(
        action=f"staging.{action}",
        entity_type="snapshots",
        entity_id=snapshot.id,
        actor_user_id=actor_user_id,
        before={},
        after={"row_index": row_index, "action": action},
    )
    db.add(audit)


# ---------------------------------------------------------------------------
# Public: GET /snapshots/{id}/staging
# ---------------------------------------------------------------------------


def get_staging_view(
    db: Session,
    snapshot_id: uuid.UUID,
    current_user: User,
    offset: int,
    limit: int,
    filter_mode: FilterMode,
) -> StagingViewResponse:
    """Build the full staging view for a snapshot (read-only).

    No DB writes.  Alias resolution is computed live via resolve_aliases_batch.
    """
    snapshot = db.get(Snapshot, snapshot_id)
    snapshot = _require_staged(snapshot, snapshot_id)
    _check_entity_scope(current_user, snapshot, db)

    parse_result: dict[str, Any] = snapshot.parse_result_json or {}
    source_hint: str = snapshot.source_hint

    invoice_rows_all: list[dict[str, Any]] = parse_result.get("invoices", [])
    cp_rows_all: list[dict[str, Any]] = parse_result.get("credit_periods", [])
    warnings_all: list[dict[str, Any]] = parse_result.get("warnings", [])
    errors_file_level: list[dict[str, Any]] = parse_result.get("errors", [])

    overrides_by_row = _build_effective_overrides(list(snapshot.staging_overrides_json or []))

    # Totals (always over the full unfiltered set)
    invoices_ok = sum(1 for i in invoice_rows_all if i.get("status") == "OK")
    invoices_pe = sum(1 for i in invoice_rows_all if i.get("status") == "PARSE_ERROR")

    totals = StagingTotals(
        invoices_total=len(invoice_rows_all),
        invoices_ok=invoices_ok,
        invoices_parse_error=invoices_pe,
        credit_periods_total=len(cp_rows_all),
        parse_warnings=len(warnings_all),
        parse_errors_file_level=len(errors_file_level),
    )

    entity_code = _get_entity_code(db, snapshot.entity_id)

    # Resolve aliases for all invoice rows in one batch pass.
    resolutions_by_raw: dict[str, AliasResolution] = {}
    if source_hint != "CREDIT_PERIOD" and invoice_rows_all:
        raw_names = [inv.get("party_name_raw", "") for inv in invoice_rows_all]
        resolutions = resolve_aliases_batch(raw_names, snapshot.entity_id, db)
        resolutions_by_raw = {name: res for name, res in zip(raw_names, resolutions, strict=False)}

    # Compute publish gate (over full unfiltered set)
    publish_gate = _compute_publish_gate(
        source_hint=source_hint,
        invoice_rows_all=invoice_rows_all,
        cp_rows_all=cp_rows_all,
        resolutions_by_raw=resolutions_by_raw,
        overrides_by_row=overrides_by_row,
        warnings_all=warnings_all,
        warnings_acknowledged_json=list(snapshot.warnings_acknowledged_json or []),
        current_user=current_user,
        snapshot_entity_id=snapshot.entity_id,
    )

    # Build rows (apply filter + pagination)
    if source_hint == "CREDIT_PERIOD":
        # No filter supported for CP rows (only "all" applies)
        filtered_cp = cp_rows_all
        total_filtered = len(filtered_cp)
        paged_cp = filtered_cp[offset : offset + limit]
        rows: list[StagingInvoiceRow] | list[StagingCreditPeriodRow] = [
            _build_cp_row(cp, overrides_by_row) for cp in paged_cp
        ]
    else:
        filtered_invs = _filter_invoice_rows(
            invoice_rows_all, filter_mode, resolutions_by_raw, overrides_by_row
        )
        total_filtered = len(filtered_invs)
        paged_invs = filtered_invs[offset : offset + limit]
        rows = [
            _build_invoice_row(
                inv,
                resolutions_by_raw.get(
                    inv.get("party_name_raw", ""),
                    AliasResolution(
                        raw_name=inv.get("party_name_raw", ""),
                        resolution_state="UNMAPPED",
                        top_matches=[],
                    ),
                ),
                overrides_by_row,
            )
            for inv in paged_invs
        ]

    log.info(
        "staging_service.get_staging_view",
        snapshot_id=str(snapshot_id),
        source_hint=source_hint,
        total_rows=len(invoice_rows_all) + len(cp_rows_all),
        filtered=total_filtered,
        offset=offset,
        limit=limit,
    )

    return StagingViewResponse(
        snapshot_id=snapshot.id,
        snapshot_status=snapshot.status,
        entity_code=entity_code,
        as_of_date=snapshot.as_of_date,
        source_hint=source_hint,
        file_sha256=snapshot.upload_file_sha256,
        uploaded_by=_get_uploader_email(snapshot),
        uploaded_at=snapshot.uploaded_at,
        totals=totals,
        publish_gate=publish_gate,
        rows=rows,
        pagination=PaginationMeta(offset=offset, limit=limit, total=total_filtered),
    )


# ---------------------------------------------------------------------------
# Public: PATCH /snapshots/{id}/staging/{row_index}
# ---------------------------------------------------------------------------


def patch_staging_row(  # noqa: PLR0912
    db: Session,
    snapshot_id: uuid.UUID,
    row_index: int,
    body: StagingPatchRequest,
    current_user: User,
) -> StagingPatchResponse:
    """Apply an analyst action to one staged row.

    Uses SELECT FOR UPDATE to serialise concurrent appends.
    All mutations are committed inside this function.
    """
    # SELECT FOR UPDATE — serialise concurrent appends
    snapshot = db.scalar(select(Snapshot).where(Snapshot.id == snapshot_id).with_for_update())
    snapshot = _require_staged(snapshot, snapshot_id)
    _check_entity_scope(current_user, snapshot, db)

    parse_result: dict[str, Any] = snapshot.parse_result_json or {}
    source_hint: str = snapshot.source_hint
    invoice_rows_all: list[dict[str, Any]] = parse_result.get("invoices", [])
    cp_rows_all: list[dict[str, Any]] = parse_result.get("credit_periods", [])

    # Find the target row
    target_inv: dict[str, Any] | None = None
    target_cp: dict[str, Any] | None = None

    for inv in invoice_rows_all:
        if inv["row_index"] == row_index:
            target_inv = inv
            break
    if target_inv is None:
        for cp in cp_rows_all:
            if cp["row_index"] == row_index:
                target_cp = cp
                break

    if target_inv is None and target_cp is None:
        from app.schemas.staging import RowNotFoundError

        raise HTTPException(
            status_code=404,
            detail=RowNotFoundError(row_index=row_index).model_dump(),
        )

    action_name = body.action

    # --- Dispatch to action handlers ---
    if action_name == "resolve_alias":
        _handle_resolve_alias(db, snapshot, row_index, body, current_user, target_inv, target_cp)

    elif action_name == "create_canonical":
        _handle_create_canonical(db, snapshot, row_index, body, current_user, target_inv, target_cp)

    elif action_name == "override_credit_days":
        _handle_override_credit_days(db, snapshot, row_index, body, current_user, target_inv)

    elif action_name == "dismiss_parse_error":
        _handle_dismiss(db, snapshot, row_index, body, current_user, target_inv, target_cp)

    elif action_name == "undismiss_parse_error":
        _handle_undismiss(db, snapshot, row_index, current_user, target_inv, target_cp)

    db.commit()
    db.refresh(snapshot)

    # Rebuild publish gate + row after commit
    overrides_by_row = _build_effective_overrides(list(snapshot.staging_overrides_json or []))
    warnings_all: list[dict[str, Any]] = parse_result.get("warnings", [])

    resolutions_by_raw: dict[str, AliasResolution] = {}
    if source_hint != "CREDIT_PERIOD" and invoice_rows_all:
        raw_names = [inv.get("party_name_raw", "") for inv in invoice_rows_all]
        resolutions = resolve_aliases_batch(raw_names, snapshot.entity_id, db)
        resolutions_by_raw = {name: res for name, res in zip(raw_names, resolutions, strict=False)}

    publish_gate = _compute_publish_gate(
        source_hint=source_hint,
        invoice_rows_all=invoice_rows_all,
        cp_rows_all=cp_rows_all,
        resolutions_by_raw=resolutions_by_raw,
        overrides_by_row=overrides_by_row,
        warnings_all=warnings_all,
        warnings_acknowledged_json=list(snapshot.warnings_acknowledged_json or []),
        current_user=current_user,
        snapshot_entity_id=snapshot.entity_id,
    )

    # Build the updated row
    if target_cp is not None:
        updated_row: StagingInvoiceRow | StagingCreditPeriodRow = _build_cp_row(
            target_cp, overrides_by_row
        )
    else:
        assert target_inv is not None
        raw_name = target_inv.get("party_name_raw", "")
        resolution = resolutions_by_raw.get(
            raw_name,
            AliasResolution(raw_name=raw_name, resolution_state="UNMAPPED", top_matches=[]),
        )
        updated_row = _build_invoice_row(target_inv, resolution, overrides_by_row)

    log.info(
        "staging_service.patch_row",
        snapshot_id=str(snapshot_id),
        row_index=row_index,
        action=action_name,
    )

    return StagingPatchResponse(row=updated_row, publish_gate=publish_gate)


# ---------------------------------------------------------------------------
# PATCH action handlers
# ---------------------------------------------------------------------------


def _handle_resolve_alias(
    db: Session,
    snapshot: Snapshot,
    row_index: int,
    body: Any,  # PatchResolveAlias
    current_user: User,
    target_inv: dict[str, Any] | None,
    target_cp: dict[str, Any] | None,
) -> None:
    """Resolve row to an existing canonical.  Optionally create alias row."""
    canonical_id: uuid.UUID = body.canonical_id

    # Validate canonical exists and belongs to snapshot.entity_id
    canonical = db.scalar(
        select(PartyCanonical).where(
            PartyCanonical.id == canonical_id,
            PartyCanonical.entity_id == snapshot.entity_id,
        )
    )
    if canonical is None:
        raise HTTPException(
            status_code=422,
            detail=f"Canonical party {canonical_id} not found for this entity.",
        )

    alias_created = False
    if body.create_alias:
        # Determine raw name from target row
        raw_name = ""
        if target_inv is not None:
            raw_name = target_inv.get("party_name_raw", "")
        elif target_cp is not None:
            raw_name = target_cp.get("name", "")

        if raw_name:
            # Insert alias if not already present (idempotent)
            existing_alias = db.scalar(
                select(PartyAlias).where(
                    PartyAlias.alias_text == raw_name,
                    PartyAlias.canonical_id == canonical_id,
                )
            )
            if existing_alias is None:
                new_alias = PartyAlias(
                    canonical_id=canonical_id,
                    alias_text=raw_name,
                    source="MANUAL",
                    confidence=None,
                    created_by=current_user.id,
                )
                db.add(new_alias)
                alias_created = True

    payload = {
        "canonical_id": str(canonical_id),
        "alias_created": alias_created,
    }
    _append_override(db, snapshot, row_index, "resolve_alias", payload, current_user.id)


def _handle_create_canonical(
    db: Session,
    snapshot: Snapshot,
    row_index: int,
    body: Any,  # PatchCreateCanonical
    current_user: User,
    target_inv: dict[str, Any] | None,
    target_cp: dict[str, Any] | None,
) -> None:
    """Create a new canonical party + alias in one transaction."""
    canonical_name: str = body.canonical_name.strip()
    if not canonical_name:
        raise HTTPException(status_code=422, detail="canonical_name must not be empty.")

    # Determine alias_text: use body.alias_text if non-empty, else raw party name
    alias_text = body.alias_text.strip() if body.alias_text else ""
    if not alias_text:
        if target_inv is not None:
            alias_text = target_inv.get("party_name_raw", "")
        elif target_cp is not None:
            alias_text = target_cp.get("name", "")

    new_canonical = PartyCanonical(
        entity_id=snapshot.entity_id,
        name=canonical_name,
        notes=body.notes or None,
        created_by=current_user.id,
    )
    db.add(new_canonical)
    try:
        db.flush()  # get new_canonical.id
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=422,
            detail=f"A canonical party named {canonical_name!r} already exists for this entity.",
        ) from exc

    if alias_text:
        new_alias = PartyAlias(
            canonical_id=new_canonical.id,
            alias_text=alias_text,
            source="MANUAL",
            confidence=None,
            created_by=current_user.id,
        )
        db.add(new_alias)

    payload = {
        "canonical_id": str(new_canonical.id),
        "alias_created": bool(alias_text),
        "canonical_created": True,
    }
    # Override action stored as "resolve_alias" (consistent with spec note)
    _append_override(db, snapshot, row_index, "resolve_alias", payload, current_user.id)


def _handle_override_credit_days(
    db: Session,
    snapshot: Snapshot,
    row_index: int,
    body: Any,  # PatchOverrideCreditDays
    current_user: User,
    target_inv: dict[str, Any] | None,
) -> None:
    """Override credit days for an OK invoice row."""
    if snapshot.source_hint == "CREDIT_PERIOD":
        raise HTTPException(
            status_code=422,
            detail="override_credit_days is not valid on CREDIT_PERIOD snapshots.",
        )
    if target_inv is None:
        raise HTTPException(
            status_code=422,
            detail="override_credit_days can only be applied to invoice rows.",
        )
    if target_inv.get("status") == "PARSE_ERROR":
        raise HTTPException(
            status_code=422,
            detail="override_credit_days cannot be applied to a PARSE_ERROR row.",
        )
    credit_days: int = body.credit_days
    if credit_days < 0:
        raise HTTPException(status_code=422, detail="credit_days must be >= 0.")

    payload = {"credit_days": credit_days, "reason": body.reason or ""}
    _append_override(db, snapshot, row_index, "override_credit_days", payload, current_user.id)


def _handle_dismiss(
    db: Session,
    snapshot: Snapshot,
    row_index: int,
    body: Any,  # PatchDismissParseError
    current_user: User,
    target_inv: dict[str, Any] | None,
    target_cp: dict[str, Any] | None,
) -> None:
    """Dismiss a PARSE_ERROR row so it doesn't block publish."""
    row_status = None
    if target_inv is not None:
        row_status = target_inv.get("status")
    elif target_cp is not None:
        # CP rows don't carry a 'status' field in the same way — treat as invalid
        raise HTTPException(
            status_code=422,
            detail="dismiss_parse_error is only valid on PARSE_ERROR rows.",
        )

    if row_status != "PARSE_ERROR":
        raise HTTPException(
            status_code=422,
            detail="dismiss_parse_error is only valid on PARSE_ERROR rows.",
        )

    payload = {"reason": body.reason or ""}
    _append_override(db, snapshot, row_index, "dismiss_parse_error", payload, current_user.id)


def _handle_undismiss(
    db: Session,
    snapshot: Snapshot,
    row_index: int,
    current_user: User,
    target_inv: dict[str, Any] | None,
    target_cp: dict[str, Any] | None,
) -> None:
    """Undo a dismiss on a PARSE_ERROR row."""
    row_status = None
    if target_inv is not None:
        row_status = target_inv.get("status")
    elif target_cp is not None:
        raise HTTPException(
            status_code=422,
            detail="undismiss_parse_error is only valid on PARSE_ERROR rows.",
        )

    if row_status != "PARSE_ERROR":
        raise HTTPException(
            status_code=422,
            detail="undismiss_parse_error is only valid on PARSE_ERROR rows.",
        )

    _append_override(db, snapshot, row_index, "undismiss_parse_error", {}, current_user.id)


# ---------------------------------------------------------------------------
# Public: PATCH /snapshots/{id}/warnings/ack
# ---------------------------------------------------------------------------


def ack_warnings(
    db: Session,
    snapshot_id: uuid.UUID,
    codes: list[str],
    current_user: User,
) -> WarningsAckResponse:
    """Acknowledge one or more warning codes on a snapshot.

    Appends to warnings_acknowledged_json.  Validates that each code exists
    in parse_result_json.warnings.
    """
    snapshot = db.scalar(select(Snapshot).where(Snapshot.id == snapshot_id).with_for_update())
    snapshot = _require_staged(snapshot, snapshot_id)
    _check_entity_scope(current_user, snapshot, db)

    parse_result: dict[str, Any] = snapshot.parse_result_json or {}
    warnings_all: list[dict[str, Any]] = parse_result.get("warnings", [])
    valid_codes = {w.get("code", "") for w in warnings_all}

    unknown = [c for c in codes if c not in valid_codes]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown warning code(s): {unknown}. Valid codes: {sorted(valid_codes)}.",
        )

    ts = datetime.now(tz=UTC).isoformat()
    current_acked: list[Any] = list(snapshot.warnings_acknowledged_json or [])
    already_acked_codes = {entry.get("code") for entry in current_acked}

    newly_acked = []
    for code in codes:
        if code not in already_acked_codes:
            current_acked.append(
                {
                    "code": code,
                    "ack_by": str(current_user.id),
                    "ack_at": ts,
                }
            )
            newly_acked.append(code)

    snapshot.warnings_acknowledged_json = current_acked

    audit = AuditLog(
        action="staging.acknowledge_warnings",
        entity_type="snapshots",
        entity_id=snapshot.id,
        actor_user_id=current_user.id,
        before={},
        after={"codes_acked": codes},
    )
    db.add(audit)
    db.commit()
    db.refresh(snapshot)

    # Recompute publish gate
    invoice_rows_all: list[dict[str, Any]] = parse_result.get("invoices", [])
    cp_rows_all: list[dict[str, Any]] = parse_result.get("credit_periods", [])
    overrides_by_row = _build_effective_overrides(list(snapshot.staging_overrides_json or []))
    resolutions_by_raw: dict[str, AliasResolution] = {}
    if snapshot.source_hint != "CREDIT_PERIOD" and invoice_rows_all:
        raw_names = [inv.get("party_name_raw", "") for inv in invoice_rows_all]
        resolutions = resolve_aliases_batch(raw_names, snapshot.entity_id, db)
        resolutions_by_raw = {name: res for name, res in zip(raw_names, resolutions, strict=False)}

    publish_gate = _compute_publish_gate(
        source_hint=snapshot.source_hint,
        invoice_rows_all=invoice_rows_all,
        cp_rows_all=cp_rows_all,
        resolutions_by_raw=resolutions_by_raw,
        overrides_by_row=overrides_by_row,
        warnings_all=warnings_all,
        warnings_acknowledged_json=list(snapshot.warnings_acknowledged_json or []),
        current_user=current_user,
        snapshot_entity_id=snapshot.entity_id,
    )

    log.info(
        "staging_service.ack_warnings",
        snapshot_id=str(snapshot_id),
        codes_count=len(codes),
    )

    return WarningsAckResponse(
        acknowledged=codes,
        publish_gate=publish_gate,
    )
