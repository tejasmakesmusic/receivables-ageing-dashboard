"""Invoice routes — GET /invoices/:id, GET /invoices, POST /invoices/:id/follow-ups (M4/M5).

RBAC: all non-PENDING roles can read.
Follow-ups: stub returning 501 (M5 extension).
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session  # noqa: TCH002

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.user import User
from app.schemas.invoice import (
    ExceptionTagRow,
    InvoiceDetailResponse,
    InvoiceListResponse,
    InvoiceListRow,
    InvoiceSnapshotHistoryRow,
)

router = APIRouter()

_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)


@router.get(
    "",
    response_model=InvoiceListResponse,
    status_code=200,
    summary="Paginated invoice list with filters (S5)",
    tags=["invoices"],
)
def list_invoices(
    entity: Annotated[str | None, Query(description="Entity code: IND or UAE")] = None,
    status: Annotated[str | None, Query(description="Invoice status: OPEN or SETTLED")] = None,
    overdue_bucket: Annotated[
        str | None,
        Query(description="Filter by bucket: NOT_DUE, 0_30, 31_60, 61_90, 90_PLUS"),
    ] = None,
    has_active_exceptions: Annotated[
        bool | None,
        Query(description="If true, only invoices with at least one ACTIVE exception tag"),
    ] = None,
    party_canonical_id: Annotated[
        uuid.UUID | None,
        Query(description="Filter by canonical party UUID"),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> InvoiceListResponse:
    """Return paginated list of invoices with optional filters.

    Returns:
        200 with InvoiceListResponse.
    """
    from app.core.rbac import Role as _Role

    # Base query with joins for canonical name, entity code
    query = (
        select(
            Invoice.id,
            Invoice.invoice_ref,
            Invoice.invoice_date,
            Invoice.amount,
            Invoice.currency,
            Invoice.due_date,
            Invoice.credit_days_applied,
            Invoice.status,
            Invoice.canonical_id,
            Invoice.entity_id,
            PartyCanonical.name.label("canonical_name"),
            Entity.code.label("entity_code"),
        )
        .join(PartyCanonical, Invoice.canonical_id == PartyCanonical.id)
        .join(Entity, Invoice.entity_id == Entity.id)
    )

    # ANALYST entity scope
    if current_user.role == _Role.ANALYST and current_user.entity_id_scope is not None:
        query = query.where(Invoice.entity_id == current_user.entity_id_scope)

    if entity:
        query = query.where(Entity.code == entity)
    if status:
        query = query.where(Invoice.status == status)
    if party_canonical_id:
        query = query.where(Invoice.canonical_id == party_canonical_id)

    # Filter by overdue_bucket requires joining invoice_snapshots
    if overdue_bucket or has_active_exceptions is True:
        pass  # will apply below in post-processing for simplicity

    # Total
    count_query = select(func.count()).select_from(query.subquery())
    total = session.scalar(count_query) or 0

    rows = session.execute(
        query.order_by(Invoice.invoice_date.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items: list[InvoiceListRow] = []
    for r in rows:
        # Get latest snapshot info
        latest_snap = session.scalar(
            select(InvoiceSnapshot)
            .where(InvoiceSnapshot.invoice_id == r.id)
            .order_by(InvoiceSnapshot.as_of_date.desc())
            .limit(1)
        )

        overdue_days = latest_snap.overdue_days if latest_snap else None
        bucket = latest_snap.bucket if latest_snap else None

        # Apply bucket filter post-query (simple implementation)
        if overdue_bucket and bucket != overdue_bucket:
            continue

        # Active exception count
        exc_count = (
            session.scalar(
                select(func.count(ExceptionTag.id)).where(
                    ExceptionTag.invoice_id == r.id,
                    ExceptionTag.status == "ACTIVE",
                )
            )
            or 0
        )

        if has_active_exceptions is True and exc_count == 0:
            continue
        if has_active_exceptions is False and exc_count > 0:
            continue

        items.append(
            InvoiceListRow(
                invoice_id=r.id,
                invoice_ref=r.invoice_ref,
                invoice_date=r.invoice_date,
                amount=r.amount,
                currency=r.currency,
                due_date=r.due_date,
                credit_days_applied=r.credit_days_applied,
                status=r.status,
                canonical_id=r.canonical_id,
                canonical_name=r.canonical_name,
                entity_code=r.entity_code,
                overdue_days=overdue_days,
                bucket=bucket,
                active_exception_count=exc_count,
            )
        )

    return InvoiceListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/{invoice_id}",
    response_model=InvoiceDetailResponse,
    status_code=200,
    summary="Invoice detail + exception tags + snapshot history (D3)",
    tags=["invoices"],
)
def get_invoice(
    invoice_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> InvoiceDetailResponse:
    """Return invoice detail with exception tags and snapshot history.

    Returns:
        200 with InvoiceDetailResponse.

    Raises:
        403: ANALYST out-of-scope.
        404: Invoice not found.
    """
    from fastapi import HTTPException

    from app.core.rbac import Role as _Role

    invoice = session.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found.")

    # Entity scope check for ANALYST
    if (
        current_user.role == _Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != invoice.entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this invoice's entity.",
        )

    # Canonical name
    canonical = session.get(PartyCanonical, invoice.canonical_id)
    canonical_name = canonical.name if canonical else str(invoice.canonical_id)

    # Entity code
    entity = session.get(Entity, invoice.entity_id)
    entity_code = entity.code if entity else "UNKNOWN"

    # Exception tags
    tags = session.scalars(
        select(ExceptionTag)
        .where(ExceptionTag.invoice_id == invoice_id)
        .order_by(ExceptionTag.tagged_at.desc())
    ).all()

    tag_rows: list[ExceptionTagRow] = []
    for tag in tags:
        bucket_type = session.get(ExceptionBucketType, tag.bucket_type_id)
        tagger = session.get(User, tag.tagged_by)
        tag_rows.append(
            ExceptionTagRow(
                id=tag.id,
                bucket_type_code=bucket_type.code if bucket_type else "",
                bucket_type_name=bucket_type.name if bucket_type else "",
                reason=tag.reason,
                tagged_at=tag.tagged_at,
                tagged_by_email=tagger.email if tagger else "",
                status=tag.status,
                expected_resolution_date=tag.expected_resolution_date,
                resolved_at=tag.resolved_at,
                resolution_note=tag.resolution_note,
            )
        )

    # Snapshot history (ordered DESC by as_of_date)
    snap_history = session.scalars(
        select(InvoiceSnapshot)
        .where(InvoiceSnapshot.invoice_id == invoice_id)
        .order_by(InvoiceSnapshot.as_of_date.desc())
    ).all()

    history_rows = [
        InvoiceSnapshotHistoryRow(
            as_of_date=s.as_of_date,
            snapshot_id=s.snapshot_id,
            outstanding_amount=s.outstanding_amount,
            overdue_days=s.overdue_days,
            bucket=s.bucket,
        )
        for s in snap_history
    ]

    return InvoiceDetailResponse(
        invoice_id=invoice.id,
        invoice_ref=invoice.invoice_ref,
        invoice_date=invoice.invoice_date,
        amount=invoice.amount,
        currency=invoice.currency,
        due_date=invoice.due_date,
        credit_days_applied=invoice.credit_days_applied,
        credit_days_source=invoice.credit_days_source,
        status=invoice.status,
        canonical_id=invoice.canonical_id,
        canonical_name=canonical_name,
        entity_code=entity_code,
        first_seen_snapshot_id=invoice.first_seen_snapshot_id,
        settled_snapshot_id=invoice.settled_snapshot_id,
        exception_tags=tag_rows,
        snapshot_history=history_rows,
    )


@router.post(
    "/{invoice_id}/follow-ups",
    status_code=501,
    summary="[STUB] Create a follow-up for an invoice (M5 extension)",
    tags=["follow-ups"],
)
def create_invoice_follow_up(
    invoice_id: uuid.UUID,
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> JSONResponse:
    """Stub endpoint — follow-up tracking is deferred to M5 extension.

    Returns:
        501 Not Implemented.
    """
    return JSONResponse(
        status_code=501,
        content={
            "code": "NOT_IMPLEMENTED",
            "detail": "Follow-up tracking coming in M5 extension.",
            "endpoint": f"/invoices/{invoice_id}/follow-ups",
        },
    )
