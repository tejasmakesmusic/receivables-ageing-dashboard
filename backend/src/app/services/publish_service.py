"""Publish service — POST /snapshots/:id/publish (M3 Task 5).

Implements the 16-step transactional publish flow (spec §5, §13).

Public interface::

    publish_snapshot(
        db, snapshot_id, body, current_user, request_ip,
    ) -> PublishResponse

Design decisions:
- ONE db.commit() at the end. All steps mutate in-memory or flush without
  committing. If any step raises, the caller's try/except will let FastAPI
  return the error and SQLAlchemy will NOT commit.
- SELECT FOR UPDATE on the snapshot row prevents concurrent publish.
- Ageing uses snapshot.as_of_date exclusively — never datetime.today().
- No raw party names / invoice refs in structlog (CLAUDE.md).
- email_outbox recipients_json is intentionally empty; M6 drain cron will
  populate from email_rules. Documented in email_outbox.py.
- Material-change flags are stored on snapshot.material_change_flags_json
  (JSONB list) for M3 simplicity. M5 staging/review UI will surface them.
- credit_days D8 priority: MANUAL override > CONFIG row > entity DEFAULT.
  If entity default is NULL and no other source exists, raise 422.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import structlog
from fastapi import HTTPException
from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.credit_period_config import CreditPeriodConfig
from app.db.models.email_outbox import EmailOutbox
from app.db.models.entity import Entity
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.snapshot import Snapshot
from app.schemas.publish import (
    CreditPeriodPublishNotImplementedError,
    PublishRequest,
    PublishResponse,
    PublishResult,
    UserRef,
)
from app.services.ageing import compute_ageing
from app.services.alias_resolver import AliasResolution, resolve_aliases_batch
from app.services.staging_service import (
    _build_effective_overrides,
    _compute_publish_gate,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User
    from app.schemas.staging import PublishGate

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _check_rbac_and_entity_scope(
    current_user: User,
    snapshot: Snapshot,
) -> str:
    """Validate role permissions and return published_as value.

    Returns:
        'NORMAL' or 'OVERRIDE' (D17)

    Raises:
        403 for CFO/PENDING or ANALYST with wrong entity scope.
    """
    if current_user.role in (Role.CFO, Role.PENDING):
        raise HTTPException(status_code=403, detail="Insufficient permissions to publish.")

    if current_user.role == Role.ADMIN:
        # ADMIN publishing a snapshot not belonging to their own scope → OVERRIDE (D17)
        # We define "their own scope" as: ADMIN has no entity scope restriction,
        # so OVERRIDE applies when the uploader is different (analyst's snapshot).
        # Simpler definition per D17: if ADMIN publishes and the snapshot was NOT
        # uploaded by that ADMIN, set OVERRIDE. This is the clearest reading of D17.
        if snapshot.uploaded_by != current_user.id:
            return "OVERRIDE"
        return "NORMAL"

    # ANALYST
    if (
        current_user.entity_id_scope is not None
        and current_user.entity_id_scope != snapshot.entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this entity.",
        )
    return "NORMAL"


def _resolve_canonical_id_for_row(
    inv: dict[str, Any],
    overrides_by_row: dict[int, dict[str, Any]],
    resolutions_by_raw: dict[str, AliasResolution],
    row_index: int,
) -> uuid.UUID:
    """Determine the canonical_id for one effective invoice row.

    Priority:
    1. Analyst override (resolve_alias / create_canonical) → use override canonical_id.
    2. Alias EXACT match → use resolved canonical_id from alias_resolver.
    3. Otherwise → integrity violation → raise 422.

    Raises:
        HTTPException 422 if canonical_id cannot be determined.
    """
    override = overrides_by_row.get(row_index)
    if override and override.get("action") in ("resolve_alias", "create_canonical"):
        canonical_id_str = override.get("payload", {}).get("canonical_id")
        if canonical_id_str:
            return uuid.UUID(canonical_id_str)

    # Fall back to EXACT alias resolution
    raw_name = inv.get("party_name_raw", "")
    resolution = resolutions_by_raw.get(raw_name)
    if (
        resolution
        and resolution.resolution_state == "EXACT"
        and resolution.top_matches
        and resolution.top_matches[0].canonical_id
    ):
        return resolution.top_matches[0].canonical_id

    raise HTTPException(
        status_code=422,
        detail={
            "code": "CANONICAL_NOT_RESOLVED",
            "row_index": row_index,
            "detail": (
                f"Invoice row {row_index} has no resolved canonical party. "
                "All OK rows must be mapped before publishing."
            ),
        },
    )


def _resolve_credit_days(
    inv: dict[str, Any],
    overrides_by_row: dict[int, dict[str, Any]],
    row_index: int,
    canonical_id: uuid.UUID,
    entity_default_credit_days: int | None,
    db: Session,
) -> tuple[int, str]:
    """Resolve credit_days per D8 priority.

    Priority:
    1. MANUAL  — analyst override_credit_days action on this row.
    2. CONFIG  — open credit_period_config row for this canonical (valid_to IS NULL).
    3. DEFAULT — entity.default_credit_days.
    4. Error   — if all three are None, raise 422.

    Returns:
        (credit_days, source)  where source in ('MANUAL', 'CONFIG', 'DEFAULT')
    """
    override = overrides_by_row.get(row_index)
    if override and override.get("action") == "override_credit_days":
        credit_days = override.get("payload", {}).get("credit_days")
        if credit_days is not None:
            return int(credit_days), "MANUAL"

    # CONFIG — most recent open row for this canonical
    config_row = db.scalar(
        select(CreditPeriodConfig)
        .where(
            CreditPeriodConfig.canonical_id == canonical_id,
            CreditPeriodConfig.valid_to.is_(None),
        )
        .limit(1)
    )
    if config_row is not None:
        return config_row.days, "CONFIG"

    # DEFAULT
    if entity_default_credit_days is not None:
        return entity_default_credit_days, "DEFAULT"

    raise HTTPException(
        status_code=422,
        detail={
            "code": "CREDIT_DAYS_UNRESOLVABLE",
            "row_index": row_index,
            "canonical_id": str(canonical_id),
            "detail": (
                f"Invoice row {row_index}: no credit_days source found. "
                "Set entity.default_credit_days or add a credit_period_config row, "
                "or use override_credit_days in staging."
            ),
        },
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def publish_snapshot(  # noqa: PLR0912, PLR0915
    db: Session,
    snapshot_id: uuid.UUID,
    body: PublishRequest,
    current_user: User,
    request_ip: str,
) -> PublishResponse:
    """Execute the full publish flow (spec §5, §13).

    All DB mutations happen under one transaction; db.commit() is called
    exactly once at the end.  Any exception causes a rollback via FastAPI's
    error handling (no explicit rollback needed here).
    """
    now_utc = datetime.now(tz=UTC)

    # -----------------------------------------------------------------------
    # Step 1: Load snapshot with row-level lock (prevent concurrent publish)
    # -----------------------------------------------------------------------
    snapshot = db.scalar(select(Snapshot).where(Snapshot.id == snapshot_id).with_for_update())
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found.")

    # -----------------------------------------------------------------------
    # Step 2: Validate state machine — must be STAGED
    # -----------------------------------------------------------------------
    if snapshot.status != "STAGED":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SNAPSHOT_NOT_STAGED",
                "snapshot_status": snapshot.status,
                "detail": "Only STAGED snapshots can be published.",
            },
        )

    # -----------------------------------------------------------------------
    # Step 3: RBAC + entity scope — compute published_as
    # -----------------------------------------------------------------------
    published_as = _check_rbac_and_entity_scope(current_user, snapshot)

    # -----------------------------------------------------------------------
    # Step 4: Short-circuit CREDIT_PERIOD → 422 (Task 6 handles this)
    # -----------------------------------------------------------------------
    if snapshot.source_hint == "CREDIT_PERIOD":
        raise HTTPException(
            status_code=422,
            detail=CreditPeriodPublishNotImplementedError().model_dump(),
        )

    # -----------------------------------------------------------------------
    # Step 5: Recompute publish gate fresh — do NOT trust stale state
    # -----------------------------------------------------------------------
    parse_result: dict[str, Any] = snapshot.parse_result_json or {}
    invoice_rows_all: list[dict[str, Any]] = parse_result.get("invoices", [])
    cp_rows_all: list[dict[str, Any]] = parse_result.get("credit_periods", [])
    warnings_all: list[dict[str, Any]] = parse_result.get("warnings", [])
    overrides_by_row = _build_effective_overrides(list(snapshot.staging_overrides_json or []))

    raw_names = [inv.get("party_name_raw", "") for inv in invoice_rows_all]
    resolutions = resolve_aliases_batch(raw_names, snapshot.entity_id, db)
    resolutions_by_raw: dict[str, AliasResolution] = {
        name: res for name, res in zip(raw_names, resolutions, strict=False)
    }

    publish_gate: PublishGate = _compute_publish_gate(
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

    if not publish_gate.ok:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PUBLISH_GATE_BLOCKED",
                "publish_gate": publish_gate.model_dump(),
                "detail": "Publish gate checks failed. Resolve all issues before publishing.",
            },
        )

    # -----------------------------------------------------------------------
    # Step 6: Determine effective invoices to publish
    # -----------------------------------------------------------------------
    # Load entity for credit_days defaults and currency derivation
    entity = db.scalar(select(Entity).where(Entity.id == snapshot.entity_id))
    if entity is None:
        raise HTTPException(status_code=500, detail="Entity not found for snapshot.")

    source_hint = snapshot.source_hint
    # Currency derived from source_hint (D-spec): TALLY → INR, XERO → AED
    currency = "INR" if source_hint == "TALLY" else "AED"

    # as_of_date must not be None for TALLY/XERO (CREDIT_PERIOD was short-circuited above)
    as_of_date: date = snapshot.as_of_date  # type: ignore[assignment]
    if as_of_date is None:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "AS_OF_DATE_MISSING",
                "detail": "as_of_date is required to compute ageing but is NULL on this snapshot.",
            },
        )

    effective_invoices: list[dict[str, Any]] = []
    for inv in invoice_rows_all:
        status = inv.get("status", "OK")

        if status == "PARSE_ERROR":
            # Dismissed PARSE_ERROR rows are skipped silently.
            # Unresolved PARSE_ERROR rows were caught by publish_gate above.
            continue  # skip all PARSE_ERROR rows

        # status == 'OK'
        effective_invoices.append(inv)

    # -----------------------------------------------------------------------
    # Steps 7-8: Resolve canonical + credit_days, then upsert into `invoices`
    # -----------------------------------------------------------------------
    entity_default_credit_days: int | None = entity.default_credit_days

    invoices_inserted = 0
    invoices_updated = 0
    # Set of invoice_ids that were in the effective set this publish
    effective_invoice_ids: set[uuid.UUID] = set()
    # Map from invoice_id → prior amount (for material-change detection)
    prior_amounts: dict[uuid.UUID, Decimal] = {}

    # Batch resolve canonicals + credit_days before upserting
    resolved_rows: list[dict[str, Any]] = []
    for inv in effective_invoices:
        row_index = inv["row_index"]

        canonical_id = _resolve_canonical_id_for_row(
            inv, overrides_by_row, resolutions_by_raw, row_index
        )
        credit_days, credit_days_source = _resolve_credit_days(
            inv,
            overrides_by_row,
            row_index,
            canonical_id,
            entity_default_credit_days,
            db,
        )

        # Parse invoice_date from string (parse_result_json stores it as ISO str)
        invoice_date_raw = inv.get("invoice_date")
        if invoice_date_raw is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVOICE_DATE_MISSING",
                    "row_index": row_index,
                    "detail": f"Invoice row {row_index} has no invoice_date.",
                },
            )
        if isinstance(invoice_date_raw, str):
            invoice_date = date.fromisoformat(invoice_date_raw)
        elif isinstance(invoice_date_raw, date):
            invoice_date = invoice_date_raw
        else:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVOICE_DATE_INVALID",
                    "row_index": row_index,
                },
            )

        due_date = invoice_date + timedelta(days=credit_days)

        # amount from parse_result_json — may be string or numeric
        amount_raw = inv.get("amount")
        if amount_raw is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "AMOUNT_MISSING",
                    "row_index": row_index,
                },
            )
        amount = Decimal(str(amount_raw))

        invoice_ref = inv.get("invoice_ref", "")

        resolved_rows.append(
            {
                "entity_id": snapshot.entity_id,
                "canonical_id": canonical_id,
                "invoice_ref": invoice_ref,
                "invoice_date": invoice_date,
                "amount": amount,
                "currency": currency,
                "credit_days_applied": credit_days,
                "credit_days_source": credit_days_source,
                "due_date": due_date,
                "first_seen_snapshot_id": snapshot.id,
                "raw_row_json": inv.get("raw_row_json", {}),
                "xero_metadata": inv.get("xero_metadata"),
                "row_index": row_index,  # scratch field — stripped before DB insert
            }
        )

    # Upsert into invoices
    for row in resolved_rows:
        row_index = row.pop("row_index")  # strip scratch field

        # Check if invoice already exists
        existing = db.scalar(
            select(Invoice).where(
                Invoice.entity_id == row["entity_id"],
                Invoice.canonical_id == row["canonical_id"],
                Invoice.invoice_ref == row["invoice_ref"],
            )
        )

        if existing is None:
            # INSERT new invoice
            new_inv = Invoice(
                entity_id=row["entity_id"],
                canonical_id=row["canonical_id"],
                invoice_ref=row["invoice_ref"],
                invoice_date=row["invoice_date"],
                amount=row["amount"],
                currency=row["currency"],
                credit_days_applied=row["credit_days_applied"],
                credit_days_source=row["credit_days_source"],
                due_date=row["due_date"],
                status="OPEN",
                first_seen_snapshot_id=row["first_seen_snapshot_id"],
                settled_snapshot_id=None,
                raw_row_json=row["raw_row_json"],
                xero_metadata=row["xero_metadata"],
            )
            db.add(new_inv)
            db.flush()  # get new_inv.id
            effective_invoice_ids.add(new_inv.id)
            invoices_inserted += 1
        else:
            # UPDATE existing invoice
            prior_amounts[existing.id] = existing.amount
            was_settled = existing.status == "SETTLED"
            existing.amount = row["amount"]
            existing.raw_row_json = row["raw_row_json"]
            existing.xero_metadata = row["xero_metadata"]
            existing.credit_days_applied = row["credit_days_applied"]
            existing.credit_days_source = row["credit_days_source"]
            existing.due_date = row["due_date"]
            existing.currency = row["currency"]
            # Resurrect SETTLED invoice if it reappears
            if was_settled:
                existing.status = "OPEN"
                existing.settled_snapshot_id = None
            effective_invoice_ids.add(existing.id)
            invoices_updated += 1

    # -----------------------------------------------------------------------
    # Step 9: SETTLED transition
    # Invoices for this entity that are OPEN but absent from effective set
    # -----------------------------------------------------------------------
    open_invoices = db.scalars(
        select(Invoice).where(
            Invoice.entity_id == snapshot.entity_id,
            Invoice.status == "OPEN",
        )
    ).all()

    invoices_settled = 0
    newly_settled_invoice_ids: list[uuid.UUID] = []
    for inv_row in open_invoices:
        if inv_row.id not in effective_invoice_ids:
            inv_row.status = "SETTLED"
            inv_row.settled_snapshot_id = snapshot.id
            invoices_settled += 1
            newly_settled_invoice_ids.append(inv_row.id)

    # -----------------------------------------------------------------------
    # Step 10: Compute invoice_snapshots rows for all effective invoices
    # (NOT for invoices being SETTLED this round)
    # -----------------------------------------------------------------------
    db.flush()  # ensure all invoice IDs are available

    # Reload effective invoices to get their IDs and current state
    effective_invoice_objs: list[Invoice] = []
    if effective_invoice_ids:
        effective_invoice_objs = list(
            db.scalars(select(Invoice).where(Invoice.id.in_(effective_invoice_ids))).all()
        )

    invoice_snapshots_written = 0
    for inv_obj in effective_invoice_objs:
        ageing_result = compute_ageing(
            invoice_date=inv_obj.invoice_date,
            credit_days=inv_obj.credit_days_applied,
            as_of_date=as_of_date,
        )
        inv_snap = InvoiceSnapshot(
            as_of_date=as_of_date,
            snapshot_id=snapshot.id,
            invoice_id=inv_obj.id,
            outstanding_amount=inv_obj.amount,
            overdue_days=ageing_result.overdue_days,
            bucket=ageing_result.bucket.value,
        )
        db.add(inv_snap)
        invoice_snapshots_written += 1

    # -----------------------------------------------------------------------
    # Step 11: Exception cascade (§13 #1) — AUTO_RESOLVE on SETTLED invoices
    # -----------------------------------------------------------------------
    exceptions_auto_resolved = 0
    if newly_settled_invoice_ids:
        # Fetch ACTIVE exception tags on the invoices we just settled
        active_tags = db.scalars(
            select(ExceptionTag).where(
                ExceptionTag.invoice_id.in_(newly_settled_invoice_ids),
                ExceptionTag.status == "ACTIVE",
            )
        ).all()
        for tag in active_tags:
            tag.status = "AUTO_RESOLVED"
            tag.resolved_at = now_utc
            tag.resolved_by = current_user.id
            tag.resolution_note = f"Auto-resolved: invoice settled in snapshot {snapshot.id}"
            exceptions_auto_resolved += 1

    # -----------------------------------------------------------------------
    # Step 12: Material-change flag (§13 #2)
    # For UPDATED invoices with ACTIVE exception_tags where amount moved >5%
    # -----------------------------------------------------------------------
    exceptions_material_change_flagged = 0
    material_flags: list[dict[str, Any]] = []

    if prior_amounts:
        # Fetch invoices that were updated and had a prior amount
        updated_invoice_ids = list(prior_amounts.keys())
        # Check for ACTIVE exception tags on these invoices
        active_exception_invoice_ids: set[uuid.UUID] = set()
        if updated_invoice_ids:
            tagged = db.scalars(
                select(ExceptionTag.invoice_id).where(
                    ExceptionTag.invoice_id.in_(updated_invoice_ids),
                    ExceptionTag.status == "ACTIVE",
                )
            ).all()
            active_exception_invoice_ids = set(tagged)

        for inv_obj in effective_invoice_objs:
            if inv_obj.id not in active_exception_invoice_ids:
                continue
            prior = prior_amounts.get(inv_obj.id)
            if prior is None or prior == Decimal("0"):
                continue
            delta = abs(inv_obj.amount - prior) / prior
            if delta > Decimal("0.05"):
                material_flags.append(
                    {
                        "invoice_id": str(inv_obj.id),
                        "prior_amount": str(prior),
                        "new_amount": str(inv_obj.amount),
                        "delta_pct": str((delta * 100).quantize(Decimal("0.01"))),
                    }
                )
                exceptions_material_change_flagged += 1

    # -----------------------------------------------------------------------
    # Step 13: Write email_outbox row (PUBLISH_NOTIF)
    # recipients_json = [] — M6 drain cron populates from email_rules
    # -----------------------------------------------------------------------
    entity_code = entity.code
    as_of_str = as_of_date.isoformat()
    outbox_row = EmailOutbox(
        rule_type="PUBLISH_NOTIF",
        snapshot_id=snapshot.id,
        recipients_json=[],  # M6 populates from email_rules at drain time
        subject=f"[EMB AR] Snapshot #{snapshot.id} published ({entity_code}, as_of={as_of_str})",
        body_html=(
            f"<p>Snapshot <strong>{snapshot.id}</strong> for entity "
            f"<strong>{entity_code}</strong> was published.</p>"
            f"<ul>"
            f"<li>As-of date: {as_of_str}</li>"
            f"<li>Invoices inserted: {invoices_inserted}</li>"
            f"<li>Invoices updated: {invoices_updated}</li>"
            f"<li>Invoices settled: {invoices_settled}</li>"
            f"<li>Invoice snapshots written: {invoice_snapshots_written}</li>"
            f"<li>Exceptions auto-resolved: {exceptions_auto_resolved}</li>"
            f"<li>Material changes flagged: {exceptions_material_change_flagged}</li>"
            f"</ul>"
        ),
        status="QUEUED",
    )
    db.add(outbox_row)

    # -----------------------------------------------------------------------
    # Step 14: Update snapshot
    # -----------------------------------------------------------------------
    snapshot.status = "PUBLISHED"
    snapshot.published_at = now_utc
    snapshot.published_by = current_user.id
    snapshot.published_as = published_as
    snapshot.material_change_flags_json = material_flags

    # -----------------------------------------------------------------------
    # Step 15: Audit log (§13 #8)
    # -----------------------------------------------------------------------
    publish_result = PublishResult(
        invoices_inserted=invoices_inserted,
        invoices_updated=invoices_updated,
        invoices_settled=invoices_settled,
        invoice_snapshots_written=invoice_snapshots_written,
        exceptions_auto_resolved=exceptions_auto_resolved,
        exceptions_material_change_flagged=exceptions_material_change_flagged,
        publish_notif_enqueued=True,
    )
    audit = AuditLog(
        action="snapshot.publish",
        entity_type="snapshots",
        entity_id=snapshot.id,
        actor_user_id=current_user.id,
        before={"status": "STAGED"},
        after={
            "status": "PUBLISHED",
            "published_as": published_as,
            "published_by": str(current_user.id),
            "override_reason": body.override_reason,
            "result": publish_result.model_dump(),
        },
    )
    db.add(audit)

    # -----------------------------------------------------------------------
    # Step 16: COMMIT
    # -----------------------------------------------------------------------
    db.commit()

    log.info(
        "publish_service.publish_snapshot",
        snapshot_id=str(snapshot_id),
        entity_id=str(snapshot.entity_id),
        published_as=published_as,
        invoices_inserted=invoices_inserted,
        invoices_updated=invoices_updated,
        invoices_settled=invoices_settled,
        invoice_snapshots_written=invoice_snapshots_written,
        exceptions_auto_resolved=exceptions_auto_resolved,
        exceptions_material_change_flagged=exceptions_material_change_flagged,
    )

    return PublishResponse(
        snapshot_id=snapshot.id,
        status="PUBLISHED",
        published_at=now_utc,
        published_by=UserRef(id=current_user.id, email=current_user.email),
        published_as=published_as,
        result=publish_result,
    )
