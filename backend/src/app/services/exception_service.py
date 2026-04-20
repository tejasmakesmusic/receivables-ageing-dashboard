"""Exception tag service — POST/PATCH /exceptions (M5).

Public interface::

    create_exception(invoice_id, body, current_user, db) -> ExceptionCreateResponse
    update_exception(exception_id, body, current_user, db) -> ExceptionUpdateResponse
    list_exceptions(filters, db) -> ExceptionListResponse

Design decisions:
- Only OPEN invoices can be tagged (SETTLED → 422).
- bucket_type must exist and active=True.
- bucket_type_code is immutable after creation (delete+recreate for audit clarity).
- RESOLVE: ACTIVE → RESOLVED, sets resolved_at/by/note. 409 if already resolved.
- Entity-scope enforced at service layer: ANALYST can only tag invoices in their entity.
- One db.commit() per mutation.
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select

from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.follow_up import FollowUp
from app.db.models.invoice import Invoice
from app.db.models.party import PartyCanonical
from app.db.models.user import User
from app.schemas.exception import (
    ExceptionCreateRequest,
    ExceptionCreateResponse,
    ExceptionListResponse,
    ExceptionListRow,
    ExceptionUpdateRequest,
    ExceptionUpdateResponse,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User as UserModel

log = structlog.get_logger(__name__)


def _check_entity_scope(
    current_user: UserModel,
    invoice: Invoice,
    db: Session,
) -> None:
    """Raise 403 if ANALYST user is scoped to a different entity than this invoice."""
    from app.core.rbac import Role

    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != invoice.entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this invoice's entity.",
        )


def create_exception(
    invoice_id: uuid.UUID,
    body: ExceptionCreateRequest,
    current_user: UserModel,
    db: Session,
) -> ExceptionCreateResponse:
    """Create a new ACTIVE exception tag on an invoice."""
    # Load invoice
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404, detail=f"Invoice {invoice_id} not found.")

    # Entity scope check
    _check_entity_scope(current_user, invoice, db)

    # Only OPEN invoices can be tagged
    if invoice.status != "OPEN":
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVOICE_NOT_OPEN",
                "invoice_status": invoice.status,
                "detail": "Exception tags can only be created on OPEN invoices.",
            },
        )

    # Validate bucket_type
    bucket_type = db.scalar(
        select(ExceptionBucketType).where(
            ExceptionBucketType.code == body.bucket_type_code,
        )
    )
    if bucket_type is None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "BUCKET_TYPE_NOT_FOUND",
                "bucket_type_code": body.bucket_type_code,
                "detail": f"Exception bucket type '{body.bucket_type_code}' not found.",
            },
        )
    if not bucket_type.active:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "BUCKET_TYPE_INACTIVE",
                "bucket_type_code": body.bucket_type_code,
                "detail": (
                    f"Exception bucket type '{body.bucket_type_code}' is inactive. "
                    "Use an active bucket type."
                ),
            },
        )

    tag = ExceptionTag(
        invoice_id=invoice_id,
        bucket_type_id=bucket_type.id,
        reason=body.reason,
        tagged_by=current_user.id,
        expected_resolution_date=body.expected_resolution_date,
        status="ACTIVE",
    )
    # note field stored in resolution_note as a pre-resolution note (not spec-mandated
    # but useful for context; stored in reason if note is None)
    db.add(tag)
    db.flush()

    audit = AuditLog(
        action="exception_tag.create",
        entity_type="exception_tags",
        entity_id=tag.id,
        actor_user_id=current_user.id,
        before=None,
        after={
            "invoice_id": str(invoice_id),
            "bucket_type_code": body.bucket_type_code,
            "status": "ACTIVE",
        },
    )
    db.add(audit)
    db.commit()

    log.info(
        "exception_service.create",
        tag_id=str(tag.id),
        bucket_type=body.bucket_type_code,
    )

    return ExceptionCreateResponse(
        id=tag.id,
        invoice_id=invoice_id,
        bucket_type_code=bucket_type.code,
        bucket_type_name=bucket_type.name,
        reason=tag.reason,
        tagged_at=tag.tagged_at,
        tagged_by_email=current_user.email,
        status=tag.status,
        expected_resolution_date=tag.expected_resolution_date,
        note=body.note,
    )


def update_exception(
    exception_id: uuid.UUID,
    body: ExceptionUpdateRequest,
    current_user: UserModel,
    db: Session,
) -> ExceptionUpdateResponse:
    """Resolve or update an exception tag."""
    tag = db.get(ExceptionTag, exception_id)
    if tag is None:
        raise HTTPException(status_code=404, detail=f"Exception {exception_id} not found.")

    # Load invoice for entity scope check
    invoice = db.get(Invoice, tag.invoice_id)
    if invoice is None:
        raise HTTPException(status_code=500, detail="Invoice not found for exception tag.")
    _check_entity_scope(current_user, invoice, db)

    now_utc = datetime.now(tz=UTC)
    before_state = {"status": tag.status}

    if body.action == "RESOLVE":
        if tag.status != "ACTIVE":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "EXCEPTION_ALREADY_RESOLVED",
                    "current_status": tag.status,
                    "detail": "Only ACTIVE exceptions can be resolved.",
                },
            )
        tag.status = "RESOLVED"
        tag.resolved_at = now_utc
        tag.resolved_by = current_user.id
        tag.resolution_note = body.resolution_note
    elif body.action == "UPDATE_NOTE":
        tag.resolution_note = body.note
    elif body.action == "UPDATE_EXPECTED_RESOLUTION_DATE":
        tag.expected_resolution_date = body.expected_resolution_date

    audit = AuditLog(
        action="exception_tag.update",
        entity_type="exception_tags",
        entity_id=exception_id,
        actor_user_id=current_user.id,
        before=before_state,
        after={
            "action": body.action,
            "status": tag.status,
        },
    )
    db.add(audit)
    db.commit()

    log.info(
        "exception_service.update",
        tag_id=str(exception_id),
        action=body.action,
    )

    return ExceptionUpdateResponse(
        id=tag.id,
        invoice_id=tag.invoice_id,
        status=tag.status,
        action_applied=body.action,
        resolved_at=tag.resolved_at,
        resolution_note=tag.resolution_note,
        note=tag.resolution_note if body.action == "UPDATE_NOTE" else None,
        expected_resolution_date=tag.expected_resolution_date,
    )


def _last_follow_up_for_canonical(
    canonical_id: uuid.UUID,
    invoice_id: uuid.UUID | None,
    db: Session,
) -> tuple[None, None] | tuple[object, str]:
    """Return (date, channel) of the most-recent follow-up for this exception row.

    Prefer a follow-up logged against the specific invoice (invoice_id scoped);
    fall back to any follow-up logged at the canonical level.
    """
    # Invoice-scoped first
    if invoice_id is not None:
        row = db.execute(
            select(FollowUp.date, FollowUp.channel)
            .where(FollowUp.invoice_id == invoice_id)
            .order_by(FollowUp.date.desc())
            .limit(1)
        ).first()
        if row is not None:
            return row.date, row.channel

    # Canonical-scoped fallback
    row = db.execute(
        select(FollowUp.date, FollowUp.channel)
        .where(FollowUp.canonical_id == canonical_id)
        .order_by(FollowUp.date.desc())
        .limit(1)
    ).first()
    if row is not None:
        return row.date, row.channel

    return None, None


def list_exceptions(
    db: Session,
    entity_code: str | None,
    status: str | None,
    bucket_type: str | None,
    invoice_id: uuid.UUID | None,
    page: int,
    page_size: int,
    current_user: UserModel,
) -> ExceptionListResponse:
    """Paginated list of exception tags with filters."""
    from app.core.rbac import Role

    query = (
        select(
            ExceptionTag.id,
            ExceptionTag.invoice_id,
            ExceptionTag.tagged_at,
            ExceptionTag.status,
            ExceptionTag.expected_resolution_date,
            ExceptionTag.resolved_at,
            ExceptionTag.reason,
            ExceptionBucketType.code.label("bucket_code"),
            ExceptionBucketType.name.label("bucket_name"),
            Invoice.invoice_ref,
            Invoice.entity_id,
            PartyCanonical.id.label("canonical_id"),
            PartyCanonical.name.label("canonical_name"),
            Entity.code.label("entity_code"),
            User.email.label("tagged_by_email"),
        )
        .join(ExceptionBucketType, ExceptionTag.bucket_type_id == ExceptionBucketType.id)
        .join(Invoice, ExceptionTag.invoice_id == Invoice.id)
        .join(PartyCanonical, Invoice.canonical_id == PartyCanonical.id)
        .join(Entity, Invoice.entity_id == Entity.id)
        .join(User, ExceptionTag.tagged_by == User.id)
    )

    # ANALYST entity scope
    if current_user.role == Role.ANALYST and current_user.entity_id_scope is not None:
        query = query.where(Invoice.entity_id == current_user.entity_id_scope)

    if entity_code:
        query = query.where(Entity.code == entity_code)
    if status:
        query = query.where(ExceptionTag.status == status)
    if bucket_type:
        query = query.where(ExceptionBucketType.code == bucket_type)
    if invoice_id:
        query = query.where(ExceptionTag.invoice_id == invoice_id)

    # Total count
    count_query = select(func.count()).select_from(query.subquery())
    total = db.scalar(count_query) or 0

    rows = db.execute(
        query.order_by(ExceptionTag.tagged_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    items = []
    for r in rows:
        fu_date, fu_channel = _last_follow_up_for_canonical(
            canonical_id=r.canonical_id,
            invoice_id=r.invoice_id,
            db=db,
        )
        items.append(
            ExceptionListRow(
                id=r.id,
                invoice_id=r.invoice_id,
                invoice_ref=r.invoice_ref,
                canonical_id=r.canonical_id,
                canonical_name=r.canonical_name,
                entity_code=r.entity_code,
                bucket_type_code=r.bucket_code,
                bucket_type_name=r.bucket_name,
                reason=r.reason,
                status=r.status,
                tagged_at=r.tagged_at,
                tagged_by_email=r.tagged_by_email,
                expected_resolution_date=r.expected_resolution_date,
                resolved_at=r.resolved_at,
                last_follow_up_date=fu_date,
                last_follow_up_channel=fu_channel,
            )
        )

    return ExceptionListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )
