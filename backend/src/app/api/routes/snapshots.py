"""Snapshot routes — POST /snapshots, GET+PATCH /snapshots/{id}/staging (spec §10).

RBAC for all routes:
  - ANALYST: allowed if entity_id_scope matches the target entity (or is NULL).
  - ADMIN: allowed for any entity.
  - CFO, PENDING: 403.

All business logic is delegated to the service layer so route handlers
remain thin adapters.
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in path parameter type annotation
from datetime import date  # noqa: TCH003 — used at runtime in Form() annotation
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.user import (
    User,  # noqa: TCH001 — needed at runtime for Annotated[User, Depends(...)]
)
from app.schemas.snapshot import SnapshotCreateResponse
from app.schemas.staging import (
    StagingPatchRequest,
    StagingPatchResponse,
    StagingViewResponse,
    WarningsAckRequest,
    WarningsAckResponse,
)
from app.services.snapshot_service import upload_snapshot
from app.services.staging_service import (
    ack_warnings,
    get_staging_view,
    patch_staging_row,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# Allowed roles (CFO + PENDING blocked here; entity-scope checked in service)
# ---------------------------------------------------------------------------
_allowed = require_role(Role.ANALYST, Role.ADMIN)


@router.post(
    "",
    response_model=SnapshotCreateResponse,
    status_code=201,
    summary="Upload a snapshot file (TALLY / XERO / CREDIT_PERIOD)",
    tags=["snapshots"],
)
def create_snapshot(
    request: Request,
    file: Annotated[UploadFile, File(description="XLSX file to upload")],
    entity_code: Annotated[str, Form(description="Target entity code: 'IND' or 'UAE'")],
    as_of_date: Annotated[
        date | None,
        Form(
            description=(
                "Snapshot date (YYYY-MM-DD). Required for TALLY. "
                "Optional for XERO (sniffed from file if absent). "
                "Not used for CREDIT_PERIOD."
            )
        ),
    ] = None,
    source_hint: Annotated[
        str | None,
        Form(
            description=(
                "Parser hint: 'TALLY', 'XERO', or 'CREDIT_PERIOD'. "
                "Auto-detected from sheet names if absent."
            )
        ),
    ] = None,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_allowed)] = ...,  # type: ignore[assignment]
) -> SnapshotCreateResponse:
    """Upload an XLSX snapshot file and enter it into the STAGED state.

    The file is parsed immediately; the result is stored in
    ``snapshots.parse_result_json`` for the staging review UI.  No invoice
    or credit-period rows are written to their target tables at this stage —
    that happens on publish (Task 5).

    Returns:
        201 with SnapshotCreateResponse on success.

    Raises:
        400: Malformed input, unknown/ambiguous source.
        403: Insufficient role or entity scope.
        409: Duplicate file (same sha256 already staged/published).
        422: Missing partition, missing as_of_date, or file-level parse errors.
        500: Unexpected parser crash.
    """
    file_bytes = file.file.read()

    if not file_bytes:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    request_ip = request.client.host if request.client else "unknown"

    return upload_snapshot(
        db=session,
        file_bytes=file_bytes,
        entity_code=entity_code,
        source_hint_form=source_hint,
        as_of_date_form=as_of_date,
        current_user=current_user,
        request_ip=request_ip,
    )


# ---------------------------------------------------------------------------
# GET /snapshots/{snapshot_id}/staging
# ---------------------------------------------------------------------------


@router.get(
    "/{snapshot_id}/staging",
    response_model=StagingViewResponse,
    status_code=200,
    summary="Paginated staging view for a snapshot",
    tags=["snapshots"],
)
def get_snapshot_staging(
    snapshot_id: uuid.UUID,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    filter: Annotated[
        Literal["all", "ok", "parse_error", "unmapped", "fuzzy_low", "fuzzy_high"],
        Query(description="Filter rows by status/resolution state"),
    ] = "all",
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_allowed)] = ...,  # type: ignore[assignment]
) -> StagingViewResponse:
    """Return paginated staged rows with alias resolution and publish gate.

    TALLY/XERO snapshots return StagingInvoiceRow entries.
    CREDIT_PERIOD snapshots return StagingCreditPeriodRow entries.

    Returns:
        200 with StagingViewResponse.

    Raises:
        403: Insufficient role or entity scope.
        404: Snapshot not found.
        409: Snapshot is not in STAGED status (SNAPSHOT_NOT_STAGED).
    """
    return get_staging_view(
        db=session,
        snapshot_id=snapshot_id,
        current_user=current_user,
        offset=offset,
        limit=limit,
        filter_mode=filter,
    )


# ---------------------------------------------------------------------------
# PATCH /snapshots/{snapshot_id}/staging/{row_index}
# ---------------------------------------------------------------------------


@router.patch(
    "/{snapshot_id}/staging/{row_index}",
    response_model=StagingPatchResponse,
    status_code=200,
    summary="Apply an analyst action to a staged row",
    tags=["snapshots"],
)
def patch_snapshot_staging_row(
    snapshot_id: uuid.UUID,
    row_index: int,
    body: StagingPatchRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_allowed)] = ...,  # type: ignore[assignment]
) -> StagingPatchResponse:
    """Apply a staging review action to one row.

    Supported actions:
    - ``resolve_alias``: map row to an existing canonical party.
    - ``create_canonical``: create a new canonical + alias then map this row.
    - ``override_credit_days``: set a manual credit-days value on an OK row.
    - ``dismiss_parse_error``: mark a PARSE_ERROR row as acknowledged.
    - ``undismiss_parse_error``: reverse a prior dismiss.

    Returns:
        200 with the updated row and an updated publish_gate snapshot.

    Raises:
        403: Insufficient role or entity scope.
        404: Snapshot or row not found.
        409: Snapshot is not in STAGED status.
        422: Invalid action for the row's current state.
    """
    return patch_staging_row(
        db=session,
        snapshot_id=snapshot_id,
        row_index=row_index,
        body=body,
        current_user=current_user,
    )


# ---------------------------------------------------------------------------
# PATCH /snapshots/{snapshot_id}/warnings/ack
# ---------------------------------------------------------------------------


@router.patch(
    "/{snapshot_id}/warnings/ack",
    response_model=WarningsAckResponse,
    status_code=200,
    summary="Acknowledge warning codes on a snapshot",
    tags=["snapshots"],
)
def ack_snapshot_warnings(
    snapshot_id: uuid.UUID,
    body: WarningsAckRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_allowed)] = ...,  # type: ignore[assignment]
) -> WarningsAckResponse:
    """Acknowledge one or more warning codes from the snapshot's parse result.

    Each code must appear in ``parse_result_json.warnings``.  Acknowledged
    codes are added to ``warnings_acknowledged_json`` (append-only, per-user).
    All codes must be acknowledged before the publish gate can be satisfied.

    Returns:
        200 with the acknowledged codes and an updated publish_gate.

    Raises:
        403: Insufficient role or entity scope.
        404: Snapshot not found.
        409: Snapshot is not in STAGED status.
        422: One or more codes not found in the snapshot's warnings list.
    """
    return ack_warnings(
        db=session,
        snapshot_id=snapshot_id,
        codes=body.codes,
        current_user=current_user,
    )
