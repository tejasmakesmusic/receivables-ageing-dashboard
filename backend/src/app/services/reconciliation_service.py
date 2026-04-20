"""Reconciliation service — GET/POST /snapshots/:id/reconciliation (M6 A6).

Public interface::

    get_or_compute_reconciliation(snapshot_id, db) -> ReconciliationResponse
    create_or_update_reconciliation(snapshot_id, body, current_user, db) -> ReconciliationResponse

Design decisions:
- delta formula (D19): delta = dashboard_ar + exception_bucket_total - tally_xero_closing_ar
- Status MATCHED: abs(delta) <= 100 (₹100 tolerance)
- Status MISMATCHED: abs(delta) > 100
- Status UNRECONCILED: tally_xero_closing_ar is NULL
- dashboard_ar = sum of outstanding_amount for OPEN invoices in this snapshot
- exception_bucket_total = sum of outstanding for invoices with ACTIVE exception tags
- ADMIN-only writes (temporary per D19 vs §9 ambiguity — documented in plan)
- Audit log on every POST/update
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select

from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.reconciliation_entry import ReconciliationEntry
from app.db.models.snapshot import Snapshot
from app.db.models.user import User
from app.schemas.reconciliation import (
    ReconciliationCreateRequest,
    ReconciliationResponse,
    UserRef,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User as UserModel

log = structlog.get_logger(__name__)

_MATCH_TOLERANCE = Decimal("100")


def _compute_dashboard_ar(snapshot: Snapshot, db: Session) -> Decimal:
    """Sum of outstanding_amount for all invoice_snapshots in this snapshot."""
    result = db.scalar(
        select(func.sum(InvoiceSnapshot.outstanding_amount)).where(
            InvoiceSnapshot.snapshot_id == snapshot.id,
            InvoiceSnapshot.as_of_date == snapshot.as_of_date,
        )
    )
    return result or Decimal("0")


def _compute_exception_bucket_totals(
    snapshot: Snapshot, db: Session
) -> tuple[Decimal, dict[str, Decimal]]:
    """Sum of outstanding for invoices with ACTIVE exception tags in this snapshot.

    Returns:
        (total, breakdown_by_bucket_code)
    """
    # Get all invoice_snapshot rows for this snapshot
    snap_rows = db.execute(
        select(
            InvoiceSnapshot.invoice_id,
            InvoiceSnapshot.outstanding_amount,
            ExceptionTag.id.label("tag_id"),
            ExceptionBucketType.code.label("bucket_code"),
        )
        .join(Invoice, InvoiceSnapshot.invoice_id == Invoice.id)
        .join(
            ExceptionTag,
            (ExceptionTag.invoice_id == InvoiceSnapshot.invoice_id)
            & (ExceptionTag.status == "ACTIVE"),
        )
        .join(ExceptionBucketType, ExceptionTag.bucket_type_id == ExceptionBucketType.id)
        .where(
            InvoiceSnapshot.snapshot_id == snapshot.id,
            InvoiceSnapshot.as_of_date == snapshot.as_of_date,
        )
    ).all()

    breakdown: dict[str, Decimal] = {}
    seen_invoice_ids: set[uuid.UUID] = set()
    total = Decimal("0")

    for row in snap_rows:
        # Count each invoice once even if it has multiple active tags
        if row.invoice_id not in seen_invoice_ids:
            seen_invoice_ids.add(row.invoice_id)
            total += row.outstanding_amount
        # Breakdown is per-bucket, summing outstanding for invoices in that bucket
        breakdown[row.bucket_code] = (
            breakdown.get(row.bucket_code, Decimal("0")) + row.outstanding_amount
        )

    return total, breakdown


def _build_response(
    snapshot: Snapshot,
    entry: ReconciliationEntry | None,
    dashboard_ar: Decimal,
    exception_bucket_total: Decimal,
    exception_bucket_breakdown: dict[str, Decimal],
    entity_code: str,
    db: Session,
) -> ReconciliationResponse:
    """Build ReconciliationResponse from computed values (+ optional existing entry)."""
    if entry is not None:
        tally_xero_closing_ar = entry.tally_xero_closing_ar
        delta = entry.delta
        status = entry.status
        entered_by_user = None
        if entry.entered_by:
            user = db.get(User, entry.entered_by)
            entered_by_user = UserRef(id=user.id, email=user.email) if user else None
        entered_at = entry.entered_at
        notes = entry.notes
    else:
        tally_xero_closing_ar = None
        delta = None
        status = "UNRECONCILED"
        entered_by_user = None
        entered_at = None
        notes = None

    return ReconciliationResponse(
        snapshot_id=snapshot.id,
        snapshot_as_of_date=snapshot.as_of_date,
        entity_code=entity_code,
        dashboard_ar=dashboard_ar,
        exception_bucket_total=exception_bucket_total,
        exception_bucket_breakdown={k: v for k, v in exception_bucket_breakdown.items()},
        tally_xero_closing_ar=tally_xero_closing_ar,
        delta=delta,
        status=status,
        entered_by=entered_by_user,
        entered_at=entered_at,
        notes=notes,
    )


def get_or_compute_reconciliation(
    snapshot_id: uuid.UUID,
    db: Session,
) -> ReconciliationResponse:
    """Fetch existing reconciliation entry or compute a dry-run.

    If no entry exists for this snapshot, computes dashboard_ar and
    exception totals fresh and returns UNRECONCILED with NULL tally/delta.
    """
    snapshot = db.get(Snapshot, snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found.")

    if snapshot.status != "PUBLISHED":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SNAPSHOT_NOT_PUBLISHED",
                "snapshot_status": snapshot.status,
                "detail": "Reconciliation is only available for PUBLISHED snapshots.",
            },
        )

    entity = db.get(Entity, snapshot.entity_id)
    if entity is None:
        raise HTTPException(status_code=500, detail="Entity not found for snapshot.")

    # Try to load existing reconciliation entry
    entry = db.scalar(
        select(ReconciliationEntry).where(ReconciliationEntry.snapshot_id == snapshot_id)
    )

    dashboard_ar = _compute_dashboard_ar(snapshot, db)
    exception_bucket_total, exception_bucket_breakdown = _compute_exception_bucket_totals(
        snapshot, db
    )

    return _build_response(
        snapshot=snapshot,
        entry=entry,
        dashboard_ar=dashboard_ar,
        exception_bucket_total=exception_bucket_total,
        exception_bucket_breakdown=exception_bucket_breakdown,
        entity_code=entity.code,
        db=db,
    )


def create_or_update_reconciliation(
    snapshot_id: uuid.UUID,
    body: ReconciliationCreateRequest,
    current_user: UserModel,
    db: Session,
) -> ReconciliationResponse:
    """Create or update reconciliation entry for a snapshot.

    RBAC per ADR-0006 (D19 vs §9 resolution):
      ANALYST writes reconciliation for their scoped entity; ADMIN writes for
      any entity; CFO/PENDING 403 (enforced at the route layer).

    Recomputes dashboard_ar, exception totals, and delta on every call.
    delta = dashboard_ar + exception_bucket_total - tally_xero_closing_ar (D19)
    """
    from app.core.rbac import Role

    snapshot = db.get(Snapshot, snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found.")

    if snapshot.status != "PUBLISHED":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SNAPSHOT_NOT_PUBLISHED",
                "detail": "Can only reconcile PUBLISHED snapshots.",
            },
        )

    # ANALYST entity-scope enforcement — ADR-0006.
    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != snapshot.entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this snapshot's entity.",
        )

    entity = db.get(Entity, snapshot.entity_id)
    if entity is None:
        raise HTTPException(status_code=500, detail="Entity not found for snapshot.")

    now_utc = datetime.now(tz=UTC)

    # Recompute fresh
    dashboard_ar = _compute_dashboard_ar(snapshot, db)
    exception_bucket_total, exception_bucket_breakdown = _compute_exception_bucket_totals(
        snapshot, db
    )

    # delta formula (D19)
    tally_ar = body.tally_xero_closing_ar
    delta = dashboard_ar + exception_bucket_total - tally_ar

    # Status determination
    status = "MATCHED" if abs(delta) <= _MATCH_TOLERANCE else "MISMATCHED"

    # Load or create entry
    entry = db.scalar(
        select(ReconciliationEntry).where(ReconciliationEntry.snapshot_id == snapshot_id)
    )

    before_state: dict = {}
    if entry is not None:
        before_state = {
            "tally_xero_closing_ar": str(entry.tally_xero_closing_ar),
            "delta": str(entry.delta),
            "status": entry.status,
        }
        entry.dashboard_ar = dashboard_ar
        entry.exception_bucket_total = exception_bucket_total
        entry.exception_bucket_breakdown = {
            k: str(v) for k, v in exception_bucket_breakdown.items()
        }
        entry.tally_xero_closing_ar = tally_ar
        entry.delta = delta
        entry.status = status
        entry.entered_by = current_user.id
        entry.entered_at = now_utc
        entry.notes = body.notes
    else:
        entry = ReconciliationEntry(
            snapshot_id=snapshot_id,
            dashboard_ar=dashboard_ar,
            exception_bucket_total=exception_bucket_total,
            exception_bucket_breakdown={k: str(v) for k, v in exception_bucket_breakdown.items()},
            tally_xero_closing_ar=tally_ar,
            delta=delta,
            status=status,
            entered_by=current_user.id,
            entered_at=now_utc,
            notes=body.notes,
        )
        db.add(entry)

    # Audit log
    audit = AuditLog(
        action="reconciliation.upsert",
        entity_type="reconciliation_entries",
        entity_id=snapshot_id,
        actor_user_id=current_user.id,
        before=before_state or None,
        after={
            "snapshot_id": str(snapshot_id),
            "tally_xero_closing_ar": str(tally_ar),
            "delta": str(delta),
            "status": status,
            "dashboard_ar": str(dashboard_ar),
            "exception_bucket_total": str(exception_bucket_total),
        },
    )
    db.add(audit)

    db.commit()

    log.info(
        "reconciliation_service.upsert",
        snapshot_id=str(snapshot_id),
        status=status,
        delta=str(delta),
    )

    return _build_response(
        snapshot=snapshot,
        entry=entry,
        dashboard_ar=dashboard_ar,
        exception_bucket_total=exception_bucket_total,
        exception_bucket_breakdown=exception_bucket_breakdown,
        entity_code=entity.code,
        db=db,
    )
