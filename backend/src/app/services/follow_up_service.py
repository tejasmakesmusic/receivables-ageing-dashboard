"""Follow-up service — CRUD logic for /follow-ups (M5 full, S6 backend).

Public interface::

    list_follow_ups(filters, db) -> FollowUpListResponse
    get_follow_up(follow_up_id, current_user, db) -> FollowUpRow
    create_follow_up(body, current_user, db) -> FollowUpRow
    update_follow_up(follow_up_id, body, current_user, db) -> FollowUpRow
    delete_follow_up(follow_up_id, current_user, db) -> None

Design notes:
- ANALYST entity-scope enforced at service layer.
- Audit log written on every mutation (FOLLOW_UP_CREATED, FOLLOW_UP_UPDATED, FOLLOW_UP_DELETED).
- One db.commit() per mutation.
- structlog events at info level on mutations.
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from datetime import date  # noqa: TCH003
from typing import TYPE_CHECKING

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select

from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.follow_up import FollowUp
from app.db.models.invoice import Invoice
from app.db.models.party import PartyCanonical
from app.db.models.user import User
from app.schemas.follow_up import (
    FollowUpCreateRequest,
    FollowUpListResponse,
    FollowUpRow,
    FollowUpUpdateRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User as UserModel

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_entity_id_for_target(
    body: FollowUpCreateRequest,
    db: Session,
) -> tuple[uuid.UUID, uuid.UUID | None, str | None]:
    """Return (canonical_id, invoice_id, invoice_ref) after validating targets exist.

    If the request anchors on an invoice, derive canonical_id from the invoice.
    """
    if body.invoice_id is not None:
        invoice = db.get(Invoice, body.invoice_id)
        if invoice is None:
            raise HTTPException(status_code=404, detail=f"Invoice {body.invoice_id} not found.")
        return invoice.canonical_id, body.invoice_id, invoice.invoice_ref

    # anchor on canonical_id
    canonical_id = body.canonical_id  # already validated non-None by model_validator
    assert canonical_id is not None  # type narrowing
    canonical = db.get(PartyCanonical, canonical_id)
    if canonical is None:
        raise HTTPException(status_code=404, detail=f"Party {canonical_id} not found.")
    return canonical_id, None, None


def _check_entity_scope(
    current_user: UserModel,
    entity_id: uuid.UUID,
) -> None:
    """Raise 403 if ANALYST user is scoped to a different entity."""
    from app.core.rbac import Role

    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this entity.",
        )


def _row_to_schema(
    fu: FollowUp,
    logged_by_email: str,
    canonical_name: str,
    invoice_ref: str | None,
) -> FollowUpRow:
    return FollowUpRow(
        id=fu.id,
        invoice_id=fu.invoice_id,
        canonical_id=fu.canonical_id,
        date=fu.date,
        channel=fu.channel,
        contact_person=fu.contact_person,
        next_action_date=fu.next_action_date,
        notes=fu.notes,
        logged_by=fu.logged_by,
        logged_by_email=logged_by_email,
        logged_at=fu.logged_at,
        canonical_name=canonical_name,
        invoice_ref=invoice_ref,
    )


def _write_audit(
    db: Session,
    *,
    action: str,
    entity_id: uuid.UUID | None,
    actor_id: uuid.UUID,
    before: dict[str, str | None] | None,
    after: dict[str, str | None] | None,
) -> None:
    audit = AuditLog(
        action=action,
        entity_type="follow_ups",
        entity_id=entity_id,
        actor_user_id=actor_id,
        before=before,
        after=after,
    )
    db.add(audit)


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------


def list_follow_ups(
    db: Session,
    *,
    entity_code: str | None,
    canonical_id: uuid.UUID | None,
    invoice_id: uuid.UUID | None,
    channel: str | None,
    date_from: date | None,
    date_to: date | None,
    page: int,
    page_size: int,
    current_user: UserModel,
) -> FollowUpListResponse:
    """Paginated list of follow-ups with optional filters."""
    from app.core.rbac import Role

    query = (
        select(
            FollowUp.id,
            FollowUp.invoice_id,
            FollowUp.canonical_id,
            FollowUp.date,
            FollowUp.channel,
            FollowUp.contact_person,
            FollowUp.next_action_date,
            FollowUp.notes,
            FollowUp.logged_by,
            FollowUp.logged_at,
            PartyCanonical.name.label("canonical_name"),
            PartyCanonical.entity_id.label("entity_id"),
            User.email.label("logged_by_email"),
            Invoice.invoice_ref.label("invoice_ref"),
            Entity.code.label("entity_code"),
        )
        .join(PartyCanonical, FollowUp.canonical_id == PartyCanonical.id)
        .join(Entity, PartyCanonical.entity_id == Entity.id)
        .join(User, FollowUp.logged_by == User.id)
        .outerjoin(Invoice, FollowUp.invoice_id == Invoice.id)
    )

    # ANALYST entity scope
    if current_user.role == Role.ANALYST and current_user.entity_id_scope is not None:
        query = query.where(PartyCanonical.entity_id == current_user.entity_id_scope)

    if entity_code:
        query = query.where(Entity.code == entity_code)
    if canonical_id:
        query = query.where(FollowUp.canonical_id == canonical_id)
    if invoice_id:
        query = query.where(FollowUp.invoice_id == invoice_id)
    if channel:
        query = query.where(FollowUp.channel == channel)
    if date_from:
        query = query.where(FollowUp.date >= date_from)
    if date_to:
        query = query.where(FollowUp.date <= date_to)

    count_query = select(func.count()).select_from(query.subquery())
    total = db.scalar(count_query) or 0

    rows = db.execute(
        query.order_by(FollowUp.logged_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items = [
        FollowUpRow(
            id=r.id,
            invoice_id=r.invoice_id,
            canonical_id=r.canonical_id,
            date=r.date,
            channel=r.channel,
            contact_person=r.contact_person,
            next_action_date=r.next_action_date,
            notes=r.notes,
            logged_by=r.logged_by,
            logged_by_email=r.logged_by_email,
            logged_at=r.logged_at,
            canonical_name=r.canonical_name,
            invoice_ref=r.invoice_ref,
        )
        for r in rows
    ]

    return FollowUpListResponse(items=items, total=total, page=page, page_size=page_size)


def get_follow_up(
    follow_up_id: uuid.UUID,
    current_user: UserModel,
    db: Session,
) -> FollowUpRow:
    """Return a single follow-up row; 404 if not found; 403 if out-of-scope."""
    fu = db.get(FollowUp, follow_up_id)
    if fu is None:
        raise HTTPException(status_code=404, detail=f"Follow-up {follow_up_id} not found.")

    canonical = db.get(PartyCanonical, fu.canonical_id)
    assert canonical is not None  # FK enforced

    _check_entity_scope(current_user, canonical.entity_id)

    logger_user = db.get(User, fu.logged_by)
    logged_by_email = logger_user.email if logger_user else ""

    invoice_ref: str | None = None
    if fu.invoice_id is not None:
        inv = db.get(Invoice, fu.invoice_id)
        invoice_ref = inv.invoice_ref if inv else None

    return _row_to_schema(fu, logged_by_email, canonical.name, invoice_ref)


def create_follow_up(
    body: FollowUpCreateRequest,
    current_user: UserModel,
    db: Session,
) -> FollowUpRow:
    """Create a new follow-up log entry."""
    canonical_id, invoice_id, invoice_ref = _resolve_entity_id_for_target(body, db)

    canonical = db.get(PartyCanonical, canonical_id)
    assert canonical is not None
    _check_entity_scope(current_user, canonical.entity_id)

    fu = FollowUp(
        invoice_id=invoice_id,
        canonical_id=canonical_id,
        date=body.date,
        channel=body.channel,
        contact_person=body.contact_person,
        next_action_date=body.next_action_date,
        notes=body.notes,
        logged_by=current_user.id,
    )
    db.add(fu)
    db.flush()

    _write_audit(
        db,
        action="FOLLOW_UP_CREATED",
        entity_id=fu.id,
        actor_id=current_user.id,
        before=None,
        after={
            "canonical_id": str(canonical_id),
            "invoice_id": str(invoice_id) if invoice_id else None,
            "channel": fu.channel,
            "date": str(fu.date),
        },
    )
    db.commit()

    log.info(
        "follow_up_service.create",
        follow_up_id=str(fu.id),
        channel=fu.channel,
    )

    return _row_to_schema(fu, current_user.email, canonical.name, invoice_ref)


def update_follow_up(
    follow_up_id: uuid.UUID,
    body: FollowUpUpdateRequest,
    current_user: UserModel,
    db: Session,
) -> FollowUpRow:
    """Partial update of a follow-up log entry."""
    fu = db.get(FollowUp, follow_up_id)
    if fu is None:
        raise HTTPException(status_code=404, detail=f"Follow-up {follow_up_id} not found.")

    canonical = db.get(PartyCanonical, fu.canonical_id)
    assert canonical is not None
    _check_entity_scope(current_user, canonical.entity_id)

    before_state = {
        "date": str(fu.date),
        "channel": fu.channel,
        "contact_person": fu.contact_person,
        "next_action_date": str(fu.next_action_date) if fu.next_action_date else None,
        "notes": fu.notes,
    }

    if body.date is not None:
        fu.date = body.date
    if body.channel is not None:
        fu.channel = body.channel
    if body.contact_person is not None:
        fu.contact_person = body.contact_person
    if body.next_action_date is not None:
        fu.next_action_date = body.next_action_date
    if body.notes is not None:
        fu.notes = body.notes

    _write_audit(
        db,
        action="FOLLOW_UP_UPDATED",
        entity_id=fu.id,
        actor_id=current_user.id,
        before=before_state,
        after={
            "date": str(fu.date),
            "channel": fu.channel,
        },
    )
    db.commit()

    log.info(
        "follow_up_service.update",
        follow_up_id=str(follow_up_id),
    )

    logger_user = db.get(User, fu.logged_by)
    logged_by_email = logger_user.email if logger_user else ""

    invoice_ref: str | None = None
    if fu.invoice_id is not None:
        inv = db.get(Invoice, fu.invoice_id)
        invoice_ref = inv.invoice_ref if inv else None

    return _row_to_schema(fu, logged_by_email, canonical.name, invoice_ref)


def delete_follow_up(
    follow_up_id: uuid.UUID,
    current_user: UserModel,
    db: Session,
) -> None:
    """Hard-delete a follow-up log entry. ADMIN only (enforced at route layer)."""
    fu = db.get(FollowUp, follow_up_id)
    if fu is None:
        raise HTTPException(status_code=404, detail=f"Follow-up {follow_up_id} not found.")

    _write_audit(
        db,
        action="FOLLOW_UP_DELETED",
        entity_id=fu.id,
        actor_id=current_user.id,
        before={
            "canonical_id": str(fu.canonical_id),
            "invoice_id": str(fu.invoice_id) if fu.invoice_id else None,
            "channel": fu.channel,
            "date": str(fu.date),
        },
        after=None,
    )
    db.delete(fu)
    db.commit()

    log.info(
        "follow_up_service.delete",
        follow_up_id=str(follow_up_id),
    )
