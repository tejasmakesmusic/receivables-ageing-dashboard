"""Config routes — /config/credit-period and /config/aliases CRUD (M3 Task 6).

RBAC summary:
  GET  credit-period:  ANALYST (own entity), ADMIN, CFO. PENDING → 403.
  POST credit-period:  ANALYST (own entity), ADMIN. CFO/PENDING → 403.
  PATCH credit-period: ADMIN only. Everyone else → 403.
  DELETE credit-period: 405 Method Not Allowed (versioning model).
  GET  aliases:        ANALYST (own entity), ADMIN, CFO. PENDING → 403.
  POST aliases:        ANALYST (own entity), ADMIN. CFO/PENDING → 403.
  PATCH aliases:       ADMIN only. Everyone else → 403.
  DELETE aliases:      ADMIN only. Everyone else → 403.

All business logic delegated to config_service.
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in path/query parameter type annotations
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.user import (
    User,  # noqa: TCH001 — needed at runtime for Annotated[User, Depends(...)]
)
from app.schemas.config import (
    AliasCreateRequest,
    AliasListResponse,
    AliasPatchRequest,
    AliasRow,
    CreditPeriodCreateRequest,
    CreditPeriodListResponse,
    CreditPeriodPatchRequest,
    CreditPeriodRow,
)
from app.services.config_service import (
    create_alias,
    create_credit_period,
    delete_alias,
    list_aliases,
    list_credit_periods,
    patch_alias,
    patch_credit_period,
)

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
