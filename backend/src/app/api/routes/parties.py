"""Party routes — GET /parties/:canonical_id and /parties/:canonical_id/follow-ups (M4/M5).

RBAC: all non-PENDING roles can read.
Follow-ups: stub returning 501 (M5 extension).
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session  # noqa: TCH002

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.entity import Entity
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.user import User  # noqa: TCH001
from app.schemas.party import PartyInvoiceRow, PartyResponse

router = APIRouter()

_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)


@router.get(
    "/{canonical_id}",
    response_model=PartyResponse,
    status_code=200,
    summary="Party drill-down — header + OPEN invoices + exceptions (D2)",
    tags=["parties"],
)
def get_party(
    canonical_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> PartyResponse:
    """Return party header, all OPEN invoices, and exception summary.

    RBAC: ANALYST entity-scoped via canonical's entity.

    Returns:
        200 with PartyResponse.

    Raises:
        403: PENDING role or ANALYST out-of-scope.
        404: Canonical party not found.
    """
    canonical = session.get(PartyCanonical, canonical_id)
    if canonical is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail=f"Party {canonical_id} not found.")

    # Entity scope check for ANALYST
    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != canonical.entity_id
    ):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this party's entity.",
        )

    entity = session.get(Entity, canonical.entity_id)
    entity_code = entity.code if entity else "UNKNOWN"
    currency_display = "INR" if entity_code == "IND" else "AED"

    # Fetch all OPEN invoices for this canonical
    invoices = session.scalars(
        select(Invoice).where(
            Invoice.canonical_id == canonical_id,
            Invoice.status == "OPEN",
        )
    ).all()

    # Get latest invoice_snapshot for each invoice
    invoice_rows: list[PartyInvoiceRow] = []
    total_outstanding = __import__("decimal").Decimal("0")

    for inv in invoices:
        # Get most recent invoice_snapshot
        latest_snap = session.scalar(
            select(InvoiceSnapshot)
            .where(InvoiceSnapshot.invoice_id == inv.id)
            .order_by(InvoiceSnapshot.as_of_date.desc())
            .limit(1)
        )

        # Count active exceptions
        exc_count = (
            session.scalar(
                select(func.count(ExceptionTag.id)).where(
                    ExceptionTag.invoice_id == inv.id,
                    ExceptionTag.status == "ACTIVE",
                )
            )
            or 0
        )

        outstanding = latest_snap.outstanding_amount if latest_snap else inv.amount
        total_outstanding += outstanding

        invoice_rows.append(
            PartyInvoiceRow(
                invoice_id=inv.id,
                invoice_ref=inv.invoice_ref,
                invoice_date=inv.invoice_date,
                amount=inv.amount,
                currency=inv.currency,
                due_date=inv.due_date,
                credit_days_applied=inv.credit_days_applied,
                credit_days_source=inv.credit_days_source,
                status=inv.status,
                overdue_days=latest_snap.overdue_days if latest_snap else None,
                bucket=latest_snap.bucket if latest_snap else None,
                outstanding_amount=outstanding,
                active_exception_count=exc_count,
            )
        )

    # Total active exceptions across all invoices
    total_exc = (
        session.scalar(
            select(func.count(ExceptionTag.id)).where(
                ExceptionTag.invoice_id.in_(
                    select(Invoice.id).where(Invoice.canonical_id == canonical_id)
                ),
                ExceptionTag.status == "ACTIVE",
            )
        )
        or 0
    )

    return PartyResponse(
        canonical_id=canonical_id,
        canonical_name=canonical.name,
        entity_code=entity_code,
        total_outstanding=total_outstanding,
        currency_display=currency_display,
        active_invoice_count=len(invoices),
        active_exception_count=total_exc,
        invoices=invoice_rows,
    )


@router.post(
    "/{canonical_id}/follow-ups",
    status_code=501,
    summary="[STUB] Create a follow-up for a party (M5 extension)",
    tags=["follow-ups"],
)
def create_party_follow_up(
    canonical_id: uuid.UUID,
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
            "endpoint": f"/parties/{canonical_id}/follow-ups",
        },
    )
