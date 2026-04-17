"""Snapshot upload route — POST /snapshots (spec §10, M3 Task 2).

RBAC:
  - ANALYST: allowed if entity_id_scope matches the target entity (or is NULL).
  - ADMIN: allowed for any entity.
  - CFO, PENDING: 403 at this gate.

All business logic is delegated to ``app.services.snapshot_service.upload_snapshot``
so this handler stays thin and the service is independently testable.
"""

from __future__ import annotations

from datetime import date  # noqa: TCH003 — used at runtime in Form() annotation
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.user import (
    User,  # noqa: TCH001 — needed at runtime for Annotated[User, Depends(...)]
)
from app.schemas.snapshot import SnapshotCreateResponse
from app.services.snapshot_service import upload_snapshot

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
