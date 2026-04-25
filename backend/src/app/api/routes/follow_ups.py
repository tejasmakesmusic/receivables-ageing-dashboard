"""Follow-up routes — CRUD /follow-ups (M5 full, S6 backend).

RBAC summary:
  GET  /follow-ups, GET /follow-ups/{id}:
    ANALYST (entity-scoped), ADMIN, CFO.
  POST /follow-ups, PATCH /follow-ups/{id}:
    ANALYST (entity-scoped), ADMIN. CFO/PENDING → 403.
  DELETE /follow-ups/{id}:
    ADMIN only.
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from datetime import date  # noqa: TCH003
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session  # noqa: TCH002

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.user import User  # noqa: TCH001
from app.schemas.follow_up import (
    FollowUpCreateRequest,
    FollowUpListResponse,
    FollowUpRow,
    FollowUpUpdateRequest,
)
from app.services.follow_up_service import (
    create_follow_up,
    delete_follow_up,
    get_follow_up,
    list_follow_ups,
    update_follow_up,
)

router = APIRouter()

_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)
_write_allowed = require_role(Role.ANALYST, Role.ADMIN)
_admin_only = require_role(Role.ADMIN)


@router.get(
    "",
    response_model=FollowUpListResponse,
    status_code=200,
    summary="Paginated list of follow-ups with filters",
    tags=["follow-ups"],
)
def list_follow_ups_route(
    entity: Annotated[str | None, Query(description="Filter by entity code: IND or UAE")] = None,
    canonical_id: Annotated[
        uuid.UUID | None, Query(description="Filter by canonical party UUID")
    ] = None,
    invoice_id: Annotated[
        uuid.UUID | None, Query(description="Filter by specific invoice UUID")
    ] = None,
    channel: Annotated[
        str | None,
        Query(description="Filter by channel: EMAIL, CALL, WHATSAPP, MEETING"),
    ] = None,
    date_from: Annotated[
        date | None, Query(description="Follow-up date on or after (inclusive)")
    ] = None,
    date_to: Annotated[
        date | None, Query(description="Follow-up date on or before (inclusive)")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> FollowUpListResponse:
    """Return paginated list of follow-ups.

    ANALYST: entity-scoped automatically.
    CFO/ADMIN: sees all entities.

    Returns:
        200 with FollowUpListResponse.
    """
    return list_follow_ups(
        db=session,
        entity_code=entity,
        canonical_id=canonical_id,
        invoice_id=invoice_id,
        channel=channel,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
        current_user=current_user,
    )


@router.get(
    "/{follow_up_id}",
    response_model=FollowUpRow,
    status_code=200,
    summary="Get a single follow-up by ID",
    tags=["follow-ups"],
)
def get_follow_up_route(
    follow_up_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> FollowUpRow:
    """Return a single follow-up entry.

    RBAC: ANALYST (entity-scoped), ADMIN, CFO.

    Returns:
        200 with FollowUpRow.

    Raises:
        403: ANALYST out-of-scope.
        404: Follow-up not found.
    """
    return get_follow_up(follow_up_id=follow_up_id, current_user=current_user, db=session)


@router.post(
    "",
    response_model=FollowUpRow,
    status_code=201,
    summary="Create a follow-up log entry",
    tags=["follow-ups"],
)
def create_follow_up_route(
    body: FollowUpCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> FollowUpRow:
    """Create a new follow-up log entry against an invoice or party.

    Exactly one of invoice_id or canonical_id must be provided in the body.

    RBAC: ANALYST (entity-scoped), ADMIN. CFO/PENDING → 403.

    Returns:
        201 with FollowUpRow.

    Raises:
        403: ANALYST out-of-scope, or CFO/PENDING role.
        404: Invoice or party not found.
        422: Validation error (both or neither target provided).
    """
    return create_follow_up(body=body, current_user=current_user, db=session)


@router.patch(
    "/{follow_up_id}",
    response_model=FollowUpRow,
    status_code=200,
    summary="Partial update of a follow-up entry",
    tags=["follow-ups"],
)
def update_follow_up_route(
    follow_up_id: uuid.UUID,
    body: FollowUpUpdateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> FollowUpRow:
    """Partially update a follow-up log entry.

    Identity-changing fields (invoice_id, canonical_id) are not allowed.

    RBAC: ANALYST (entity-scoped), ADMIN. CFO/PENDING → 403.

    Returns:
        200 with FollowUpRow.

    Raises:
        403: ANALYST out-of-scope or insufficient role.
        404: Follow-up not found.
    """
    return update_follow_up(
        follow_up_id=follow_up_id, body=body, current_user=current_user, db=session
    )


@router.delete(
    "/{follow_up_id}",
    status_code=204,
    response_model=None,
    summary="Hard-delete a follow-up entry (ADMIN only)",
    tags=["follow-ups"],
)
def delete_follow_up_route(
    follow_up_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> None:
    """Hard-delete a follow-up log entry.

    RBAC: ADMIN only.

    Returns:
        204 No Content.

    Raises:
        403: Non-ADMIN role.
        404: Follow-up not found.
    """
    delete_follow_up(follow_up_id=follow_up_id, current_user=current_user, db=session)
