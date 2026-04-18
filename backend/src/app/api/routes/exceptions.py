"""Exception tag routes — POST/PATCH /exceptions and GET /exceptions (M5).

RBAC:
  POST /invoices/:id/exceptions: ANALYST (entity-scoped) or ADMIN.
  PATCH /exceptions/:id: ANALYST (entity-scoped) or ADMIN.
  GET /exceptions: all non-PENDING (read).
"""

from __future__ import annotations

import uuid  # noqa: TCH003
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session  # noqa: TCH002

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.user import User  # noqa: TCH001
from app.schemas.exception import (
    ExceptionCreateRequest,
    ExceptionCreateResponse,
    ExceptionListResponse,
    ExceptionUpdateRequest,
    ExceptionUpdateResponse,
)
from app.services.exception_service import (
    create_exception,
    list_exceptions,
    update_exception,
)

router = APIRouter()

_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)
_write_allowed = require_role(Role.ANALYST, Role.ADMIN)


@router.post(
    "/invoices/{invoice_id}/exceptions",
    response_model=ExceptionCreateResponse,
    status_code=201,
    summary="Create an exception tag on an invoice",
    tags=["exceptions"],
)
def create_exception_route(
    invoice_id: uuid.UUID,
    body: ExceptionCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> ExceptionCreateResponse:
    """Create a new ACTIVE exception tag on an invoice.

    RBAC: ANALYST (entity-scoped) or ADMIN.

    Returns:
        201 with ExceptionCreateResponse.

    Raises:
        400: bucket_type_code not found or inactive.
        403: ANALYST out-of-scope.
        404: Invoice not found.
        422: Invoice is not OPEN.
    """
    return create_exception(
        invoice_id=invoice_id,
        body=body,
        current_user=current_user,
        db=session,
    )


@router.patch(
    "/exceptions/{exception_id}",
    response_model=ExceptionUpdateResponse,
    status_code=200,
    summary="Resolve or update an exception tag",
    tags=["exceptions"],
)
def update_exception_route(
    exception_id: uuid.UUID,
    body: ExceptionUpdateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> ExceptionUpdateResponse:
    """Resolve or update an exception tag.

    Actions:
    - RESOLVE: ACTIVE → RESOLVED. 409 if already resolved/auto-resolved.
    - UPDATE_NOTE: update the resolution_note on an ACTIVE exception.
    - UPDATE_EXPECTED_RESOLUTION_DATE: update the expected resolution date.

    bucket_type_code is IMMUTABLE after creation — delete + recreate for changes.

    RBAC: ANALYST (entity-scoped) or ADMIN.

    Returns:
        200 with ExceptionUpdateResponse.

    Raises:
        403: ANALYST out-of-scope.
        404: Exception tag not found.
        409: Already resolved (RESOLVE action on non-ACTIVE tag).
    """
    return update_exception(
        exception_id=exception_id,
        body=body,
        current_user=current_user,
        db=session,
    )


@router.get(
    "/exceptions",
    response_model=ExceptionListResponse,
    status_code=200,
    summary="Paginated list of exception tags with filters",
    tags=["exceptions"],
)
def list_exceptions_route(
    entity: Annotated[str | None, Query(description="Filter by entity code: IND or UAE")] = None,
    status: Annotated[
        str | None, Query(description="Filter by status: ACTIVE, RESOLVED, AUTO_RESOLVED")
    ] = None,
    bucket_type: Annotated[
        str | None, Query(description="Filter by bucket type code, e.g. DISPUTED")
    ] = None,
    invoice_id: Annotated[
        uuid.UUID | None, Query(description="Filter by specific invoice UUID")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> ExceptionListResponse:
    """Return paginated list of exception tags.

    ANALYST: entity-scoped automatically.
    CFO/ADMIN: sees all entities.

    Returns:
        200 with ExceptionListResponse.
    """
    return list_exceptions(
        db=session,
        entity_code=entity,
        status=status,
        bucket_type=bucket_type,
        invoice_id=invoice_id,
        page=page,
        page_size=page_size,
        current_user=current_user,
    )
