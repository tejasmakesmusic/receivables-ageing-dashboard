"""Follow-up routes — stub endpoints returning 501 (M5 extension).

All routes are registered to preserve URL shape for the frontend.
Full CRUD implementation deferred to M5 extension.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.api.deps import require_role
from app.core.rbac import Role
from app.db.models.user import User  # noqa: TCH001

router = APIRouter()

_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)

_NOT_IMPLEMENTED = JSONResponse(
    status_code=501,
    content={
        "code": "NOT_IMPLEMENTED",
        "detail": "Follow-up tracking coming in M5 extension.",
    },
)


@router.get(
    "",
    status_code=501,
    summary="[STUB] List follow-ups (M5 extension)",
    tags=["follow-ups"],
)
def list_follow_ups(
    entity: Annotated[str | None, Query()] = None,
    canonical_id: Annotated[str | None, Query()] = None,
    invoice_id: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> JSONResponse:
    """Stub — follow-up tracking coming in M5 extension.

    Returns:
        501 Not Implemented.
    """
    return JSONResponse(
        status_code=501,
        content={
            "code": "NOT_IMPLEMENTED",
            "detail": "Follow-up tracking coming in M5 extension.",
            "endpoint": "/follow-ups",
        },
    )
