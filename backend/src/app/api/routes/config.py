"""Config routes — /config/credit-period, /config/aliases, /config/fx-rates CRUD.

RBAC summary:
  GET  credit-period:                 ANALYST (own entity), ADMIN, CFO. PENDING → 403.
  GET  credit-period/default-parties: ANALYST, ADMIN, CFO. PENDING → 403. (A.4)
  POST credit-period:                 ANALYST (own entity), ADMIN. CFO/PENDING → 403.
  PATCH credit-period:                ADMIN only. Everyone else → 403.
  DELETE credit-period:               405 Method Not Allowed (versioning model).
  GET  aliases:                       ANALYST (own entity), ADMIN, CFO. PENDING → 403.
  POST aliases:                       ANALYST (own entity), ADMIN. CFO/PENDING → 403.
  PATCH aliases:                      ADMIN only. Everyone else → 403.
  DELETE aliases:                     ADMIN only. Everyone else → 403.
  GET  fx-rates:                      All non-PENDING read.
  POST fx-rates:                      ADMIN only. Immutable rows per D15.

All business logic delegated to config_service / fx_rate_service /
default_cp_nudge_service (read-only for the report endpoint).
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in path/query parameter type annotations
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.fx_rate import FxRate, FxRateSource
from app.db.models.user import (
    User,  # noqa: TCH001 — needed at runtime for Annotated[User, Depends(...)]
)
from app.schemas.config import (
    AliasCreateRequest,
    AliasListResponse,
    AliasPatchRequest,
    AliasRow,
    CreditPeriodCreateRequest,
    CreditPeriodEditRequest,
    CreditPeriodEditResponse,
    CreditPeriodListResponse,
    CreditPeriodPatchRequest,
    CreditPeriodRow,
    DefaultCpPartyReportRow,
    DefaultCpReportResponse,
)
from app.schemas.fx_rate import FxRateCreateRequest, FxRateListResponse, FxRateRow
from app.services.config_service import (
    create_alias,
    create_credit_period,
    delete_alias,
    edit_credit_period,
    list_aliases,
    list_credit_periods,
    patch_alias,
    patch_credit_period,
)
from app.services.default_cp_nudge_service import compute_default_cp_payload

router = APIRouter()

# ---------------------------------------------------------------------------
# RBAC dependency factories
# ---------------------------------------------------------------------------
# Read: ANALYST/ADMIN/CFO (PENDING blocked)
_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)
# Write: ANALYST/ADMIN only (CFO + PENDING blocked)
_write_allowed = require_role(Role.ANALYST, Role.ADMIN)
# Admin only
_admin_only = require_role(Role.ADMIN)


# ===========================================================================
# Credit-period config
# ===========================================================================


@router.get(
    "/credit-period/default-parties",
    response_model=DefaultCpReportResponse,
    status_code=200,
    summary="Parties on entity-default credit period (spec §13 #5, A.4)",
    tags=["config"],
)
def get_default_cp_parties(
    entity_code: Annotated[
        str, Query(description="Entity to report on: IND or UAE")
    ],
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> DefaultCpReportResponse:
    """Return the list of parties whose open invoices use the entity-default credit period.

    Re-uses ``compute_default_cp_payload`` from ``default_cp_nudge_service`` —
    the same data that drives the weekly analyst nudge email (spec §13 #5) is now
    surfaced on S3 so analysts can act immediately.

    RBAC: ANALYST / ADMIN / CFO read. PENDING → 403.

    Raises:
        422: entity_code not in ('IND', 'UAE').
        404: Entity not found or no published snapshot for that entity.
    """
    import structlog as _structlog

    _log = _structlog.get_logger(__name__)

    if entity_code not in ("IND", "UAE"):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_ENTITY_CODE",
                "detail": "entity_code must be 'IND' or 'UAE'.",
            },
        )

    try:
        payload = compute_default_cp_payload(entity_code, session)
    except ValueError as exc:
        _log.info(
            "config.default_cp_report.no_data",
            entity_code=entity_code,
            reason=str(exc),
        )
        raise HTTPException(
            status_code=404,
            detail={
                "code": "NO_PUBLISHED_SNAPSHOT",
                "detail": str(exc),
            },
        ) from exc

    parties = [
        DefaultCpPartyReportRow(
            canonical_id=p.canonical_id,
            canonical_name=p.canonical_name,
            total_outstanding=str(p.total_outstanding),
            n_open_invoices=p.n_open_invoices,
        )
        for p in payload.top_parties
    ]

    return DefaultCpReportResponse(
        entity_code=entity_code,  # type: ignore[arg-type]
        as_of_date=payload.as_of_date,
        snapshot_id=payload.snapshot_id,
        currency_display=payload.currency_display,
        total_parties_on_default=payload.total_parties_on_default,
        parties=parties,
    )


@router.get(
    "/credit-period",
    response_model=CreditPeriodListResponse,
    status_code=200,
    summary="List credit-period config rows",
    tags=["config"],
)
def get_credit_periods(
    entity_code: Annotated[
        str | None, Query(description="Filter by entity code: IND or UAE")
    ] = None,
    include_closed: Annotated[
        bool, Query(description="Include rows where valid_to IS NOT NULL")
    ] = False,
    party_name_contains: Annotated[
        str | None, Query(description="Case-insensitive party name filter")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> CreditPeriodListResponse:
    """List credit_period_config rows.

    Open rows (valid_to IS NULL) are the currently active credit terms.
    Pass include_closed=true to see historical versions.
    """
    return list_credit_periods(
        db=session,
        entity_code=entity_code,
        include_closed=include_closed,
        party_name_contains=party_name_contains,
        page=page,
        page_size=page_size,
        current_user=current_user,
    )


@router.post(
    "/credit-period",
    response_model=CreditPeriodRow,
    status_code=201,
    summary="Create a new credit-period config row",
    tags=["config"],
)
def post_credit_period(
    body: CreditPeriodCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> CreditPeriodRow:
    """Create a new credit-period config row for a canonical party.

    If an open row (valid_to IS NULL) already exists for this canonical, it is
    automatically closed: valid_to is set to valid_from - 1 day.

    Pass today's date as valid_from if no specific future effective date is needed.
    The service does not default valid_from server-side (CLAUDE.md guardrail:
    no date.today() reads in service code).
    """
    return create_credit_period(db=session, body=body, current_user=current_user)


@router.patch(
    "/credit-period/{config_id}",
    response_model=CreditPeriodRow,
    status_code=200,
    summary="Update the open credit-period config row (ADMIN only)",
    tags=["config"],
)
def patch_credit_period_route(
    config_id: uuid.UUID,
    body: CreditPeriodPatchRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> CreditPeriodRow:
    """Update credit_days and/or reason_note on the OPEN row (valid_to IS NULL).

    ADMIN only — analysts must create a new row for version history.
    Raises 409 if the row is closed (valid_to IS NOT NULL).
    Immutable fields: valid_from, canonical_id, valid_to.
    """
    return patch_credit_period(
        db=session, config_id=config_id, body=body, current_user=current_user
    )


@router.delete(
    "/credit-period/{config_id}",
    status_code=405,
    summary="DELETE not supported — credit-period config is versioned",
    tags=["config"],
)
def delete_credit_period_route(
    config_id: uuid.UUID,
) -> Response:
    """DELETE is not supported for credit-period config.

    Credit period config rows are versioned for auditability. To effectively
    'remove' a credit period:
    - POST a new row with credit_days set to the entity default (closes the prior row).
    - Or update via the admin UI once M4 is live.

    This matches the D15-style immutability model for audit trails.
    """
    return Response(
        content=(
            '{"detail": "DELETE is not supported for credit-period config. '
            'Config rows are versioned. POST a new row to update credit terms."}'
        ),
        status_code=405,
        media_type="application/json",
        headers={"Allow": "GET, POST, PATCH"},
    )


@router.post(
    "/credit-period/{canonical_id}",
    response_model=CreditPeriodEditResponse,
    status_code=200,
    summary="Analyst-facing one-off edit for a canonical's credit period (ADR-0005 D3)",
    tags=["config"],
)
def edit_credit_period_route(
    canonical_id: uuid.UUID,
    body: CreditPeriodEditRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> CreditPeriodEditResponse:
    """Supersede the active credit_period_config for a canonical party.

    RBAC: ANALYST (own entity), ADMIN (any). CFO/PENDING → 403.

    Idempotency (ADR-0005 D3):
      - Same (days, reason_note) as active config → 200 {result='noop'} — no DB writes.
      - Differing values → supersede: old row closed (valid_to = today - 1 day),
        new row inserted (valid_from = today, valid_to = NULL).
      - No active config → insert directly.

    Response result field: 'inserted' | 'superseded' | 'noop'.
    Audit log action: CREDIT_PERIOD_EDITED.
    """
    today = datetime.now(tz=UTC).date()
    return edit_credit_period(
        db=session,
        canonical_id=canonical_id,
        body=body,
        current_user=current_user,
        today=today,
    )


# ===========================================================================
# Alias config
# ===========================================================================


@router.get(
    "/aliases",
    response_model=AliasListResponse,
    status_code=200,
    summary="List alias config rows",
    tags=["config"],
)
def get_aliases(
    entity_code: Annotated[
        str | None, Query(description="Filter by entity code: IND or UAE")
    ] = None,
    canonical_id: Annotated[
        uuid.UUID | None, Query(description="Filter by canonical party UUID")
    ] = None,
    alias_text_contains: Annotated[
        str | None, Query(description="Case-insensitive alias text filter")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> AliasListResponse:
    """List party_aliases with optional filters."""
    return list_aliases(
        db=session,
        entity_code=entity_code,
        canonical_id=canonical_id,
        alias_text_contains=alias_text_contains,
        page=page,
        page_size=page_size,
        current_user=current_user,
    )


@router.post(
    "/aliases",
    response_model=AliasRow,
    status_code=201,
    summary="Create a MANUAL alias for a canonical party",
    tags=["config"],
)
def post_alias(
    body: AliasCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> AliasRow:
    """Create a MANUAL alias for a canonical party.

    alias_text is stripped of leading/trailing whitespace before insertion.
    UNIQUE(alias_text, canonical_id) violation → 409 ALIAS_ALREADY_EXISTS.

    TALLY and XERO source aliases are created automatically by the parsers;
    aliases created via this endpoint are always source='MANUAL'.
    """
    return create_alias(db=session, body=body, current_user=current_user)


@router.patch(
    "/aliases/{alias_id}",
    response_model=AliasRow,
    status_code=200,
    summary="Update alias text (ADMIN only)",
    tags=["config"],
)
def patch_alias_route(
    alias_id: uuid.UUID,
    body: AliasPatchRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> AliasRow:
    """Update the alias_text on an existing alias. ADMIN only.

    Analysts are expected to delete + recreate for clarity in the audit trail.
    UNIQUE(alias_text, canonical_id) constraint still applies → 409 on collision.
    """
    return patch_alias(db=session, alias_id=alias_id, body=body, current_user=current_user)


@router.delete(
    "/aliases/{alias_id}",
    status_code=204,
    summary="Hard-delete an alias (ADMIN only)",
    tags=["config"],
)
def delete_alias_route(
    alias_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> Response:
    """Hard-delete an alias. ADMIN only.

    This does NOT cascade to invoices.canonical_id — published invoices
    keep their resolved canonical. Only future uploads lose the alias match.
    Audit log records the full row payload in before_json.
    """
    delete_alias(db=session, alias_id=alias_id, current_user=current_user)
    return Response(status_code=204)


# ===========================================================================
# FX rates (M6 A4)
# ===========================================================================


@router.get(
    "/fx-rates",
    response_model=FxRateListResponse,
    status_code=200,
    summary="List FX rates (A4)",
    tags=["config"],
)
def get_fx_rates(
    from_ccy: Annotated[
        str | None, Query(description="Filter by source currency, e.g. AED")
    ] = None,
    to_ccy: Annotated[str | None, Query(description="Filter by target currency, e.g. INR")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> FxRateListResponse:
    """List FX rates. All non-PENDING can read. Immutable per D15.

    Returns:
        200 with FxRateListResponse.
    """
    query = select(FxRate)
    if from_ccy:
        query = query.where(FxRate.from_ccy == from_ccy.upper())
    if to_ccy:
        query = query.where(FxRate.to_ccy == to_ccy.upper())

    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        query.order_by(FxRate.effective_from.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items = [
        FxRateRow(
            id=r.id,
            from_ccy=r.from_ccy,
            to_ccy=r.to_ccy,
            rate=r.rate,
            valid_from=r.effective_from,
            source=r.source.value if hasattr(r.source, "value") else str(r.source),
            created_at=r.created_at,
            created_by_email=(r.creator.email if r.creator else None),
        )
        for r in rows
    ]

    return FxRateListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post(
    "/fx-rates",
    response_model=FxRateRow,
    status_code=201,
    summary="Create a new immutable FX rate (ADMIN only, A4)",
    tags=["config"],
)
def create_fx_rate(
    body: FxRateCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> FxRateRow:
    """Create a new FX rate row. ADMIN only. Immutable per D15.

    valid_to is always NULL — no PATCH or DELETE is exposed.
    Raises 409 if a rate with the same (from_ccy, to_ccy, effective_from) exists.

    Returns:
        201 with FxRateRow.
    """
    import structlog

    log = structlog.get_logger(__name__)

    # Check for duplicate (unique on from_ccy, to_ccy, effective_from)
    existing = session.scalar(
        select(FxRate).where(
            FxRate.from_ccy == body.from_ccy,
            FxRate.to_ccy == body.to_ccy,
            FxRate.effective_from == body.valid_from,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "FX_RATE_DUPLICATE",
                "detail": (
                    f"A rate for {body.from_ccy}→{body.to_ccy} "
                    f"effective {body.valid_from} already exists."
                ),
            },
        )

    new_rate = FxRate(
        from_ccy=body.from_ccy,
        to_ccy=body.to_ccy,
        rate=body.rate,
        effective_from=body.valid_from,
        effective_to=None,  # always NULL per D15
        source=FxRateSource.MANUAL,
        created_by=current_user.id,
    )
    session.add(new_rate)
    session.flush()

    audit = AuditLog(
        action="fx_rate.create",
        entity_type="fx_rates",
        entity_id=new_rate.id,
        actor_user_id=current_user.id,
        before=None,
        after={
            "from_ccy": body.from_ccy,
            "to_ccy": body.to_ccy,
            "rate": str(body.rate),
            "effective_from": body.valid_from.isoformat(),
        },
    )
    session.add(audit)
    session.commit()

    log.info(
        "config.fx_rate_create",
        from_ccy=body.from_ccy,
        to_ccy=body.to_ccy,
        effective_from=body.valid_from.isoformat(),
    )

    return FxRateRow(
        id=new_rate.id,
        from_ccy=new_rate.from_ccy,
        to_ccy=new_rate.to_ccy,
        rate=new_rate.rate,
        valid_from=new_rate.effective_from,
        source=new_rate.source.value,
        created_at=new_rate.created_at,
        created_by_email=current_user.email,
    )


@router.patch(
    "/fx-rates/{rate_id}",
    status_code=405,
    summary="FX rate PATCH not supported — immutable per D15",
    tags=["config"],
)
def patch_fx_rate(rate_id: uuid.UUID) -> Response:
    """FX rates are immutable per D15. PATCH is not supported."""
    return Response(
        content='{"detail": "FX rates are immutable (spec D15). Create a new row."}',
        status_code=405,
        media_type="application/json",
        headers={"Allow": "GET, POST"},
    )


@router.delete(
    "/fx-rates/{rate_id}",
    status_code=405,
    summary="FX rate DELETE not supported — immutable per D15",
    tags=["config"],
)
def delete_fx_rate(rate_id: uuid.UUID) -> Response:
    """FX rates are immutable per D15. DELETE is not supported."""
    return Response(
        content='{"detail": "FX rates are immutable (spec D15). Create a new row."}',
        status_code=405,
        media_type="application/json",
        headers={"Allow": "GET, POST"},
    )
