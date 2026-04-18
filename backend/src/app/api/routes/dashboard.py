"""Dashboard routes — GET /dashboard (M4 D1).

RBAC: ALL authenticated non-PENDING roles can read.
  - ADMIN: sees all entities.
  - CFO: sees all entities (read-only across board).
  - ANALYST: sees all entities (no entity-restriction for read at dashboard level).
  - PENDING: 403.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import (
    Session,  # noqa: TCH002
)

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.user import User  # noqa: TCH001
from app.schemas.dashboard import DashboardResponse
from app.services.dashboard_service import get_dashboard

router = APIRouter()

_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)


@router.get(
    "",
    response_model=DashboardResponse,
    status_code=200,
    summary="Dashboard KPIs, ageing buckets, top parties (D1)",
    tags=["dashboard"],
)
def get_dashboard_route(
    entity: Annotated[
        Literal["IND", "UAE", "ALL"],
        Query(description="Entity to display: IND, UAE, or ALL (consolidated)"),
    ] = "IND",
    as_of: Annotated[
        str,
        Query(
            description=(
                "'latest' for the most recent published snapshot, "
                "or YYYY-MM-DD to pin to a specific date."
            )
        ),
    ] = "latest",
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> DashboardResponse:
    """Return dashboard KPIs for the given entity and snapshot date.

    For entity=ALL (Consolidated):
    - AED values are converted to INR using fx_rates pinned by each
      invoice's invoice_date (spec §7).
    - If any invoice has no applicable FX rate → 422 FX_RATE_MISSING.

    Returns:
        200 with DashboardResponse.

    Raises:
        403: PENDING role.
        404: No published snapshot found.
        422: Missing FX rate (consolidated view only).
    """
    return get_dashboard(entity=entity, as_of=as_of, db=session)
