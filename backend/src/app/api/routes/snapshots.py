"""Snapshot routes — POST /snapshots, GET+PATCH /snapshots/{id}/staging (spec §10).

RBAC for all routes:
  - ANALYST: allowed if entity_id_scope matches the target entity (or is NULL).
  - ADMIN: allowed for any entity.
  - CFO: allowed for read-only routes (list, detail).
  - PENDING: 403.

All business logic is delegated to the service layer so route handlers
remain thin adapters.
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — used at runtime in path parameter type annotation
from datetime import date  # noqa: TCH003 — used at runtime in Form() annotation
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.rbac import Role
from app.db.models.entity import Entity
from app.db.models.snapshot import Snapshot
from app.db.models.user import (
    User,
)
from app.schemas.admin import SnapshotDetailResponse, SnapshotListResponse, SnapshotListRow
from app.schemas.discard import DiscardRequest, DiscardResponse
from app.schemas.publish import PublishRequest, PublishResponse
from app.schemas.snapshot import SnapshotCreateResponse
from app.schemas.staging import (
    StagingPatchRequest,
    StagingPatchResponse,
    StagingViewResponse,
    WarningsAckRequest,
    WarningsAckResponse,
)
from app.services.discard_service import discard_snapshot
from app.services.publish_service import publish_snapshot
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
_read_allowed = require_role(Role.ANALYST, Role.ADMIN, Role.CFO)


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


# ---------------------------------------------------------------------------
# POST /snapshots/{snapshot_id}/publish
# ---------------------------------------------------------------------------


@router.post(
    "/{snapshot_id}/publish",
    response_model=PublishResponse,
    status_code=200,
    summary="Publish a staged snapshot — upsert invoices into canonical table",
    tags=["snapshots"],
)
def publish_snapshot_route(
    snapshot_id: uuid.UUID,
    request: Request,
    body: PublishRequest | None = None,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_allowed)] = ...,  # type: ignore[assignment]
) -> PublishResponse:
    """Transition a STAGED snapshot to PUBLISHED.

    Upserts all OK invoice rows into the canonical ``invoices`` table,
    writes ``invoice_snapshots`` rows with ageing computed via
    ``compute_ageing(as_of_date=snapshot.as_of_date)``, settles absent
    invoices, cascades exception_tags to AUTO_RESOLVED, flags material
    amount changes, and enqueues a PUBLISH_NOTIF email.

    RBAC:
    - ANALYST: allowed if entity_id_scope matches snapshot entity.
    - ADMIN: allowed for any entity. Sets published_as='OVERRIDE' if
      the snapshot was uploaded by a different user.
    - CFO, PENDING: 403.

    Returns:
        200 with PublishResponse on success.

    Raises:
        403: Insufficient role or entity scope.
        404: Snapshot not found.
        409: Snapshot is not in STAGED status.
        422: Publish gate not satisfied, CREDIT_PERIOD source, or
             missing canonical / credit_days resolution.
    """
    request_ip = request.client.host if request.client else "unknown"
    return publish_snapshot(
        db=session,
        snapshot_id=snapshot_id,
        body=body or PublishRequest(),
        current_user=current_user,
        request_ip=request_ip,
    )


# ---------------------------------------------------------------------------
# POST /snapshots/{snapshot_id}/discard
# ---------------------------------------------------------------------------


@router.post(
    "/{snapshot_id}/discard",
    response_model=DiscardResponse,
    status_code=200,
    summary="Discard a staged snapshot — terminal transition, cannot be undone",
    tags=["snapshots"],
)
def discard_snapshot_route(
    snapshot_id: uuid.UUID,
    body: DiscardRequest | None = None,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_allowed)] = ...,  # type: ignore[assignment]
) -> DiscardResponse:
    """Transition a STAGED snapshot to DISCARDED (terminal state).

    Only STAGED snapshots can be discarded. DISCARDED is final — there is no
    un-discard path. A new file must be uploaded to replace a discarded snapshot.

    RBAC:
    - ANALYST: allowed if entity_id_scope matches snapshot entity.
    - ADMIN: allowed for any entity.
    - CFO, PENDING: 403.

    Returns:
        200 with DiscardResponse on success.

    Raises:
        403: Insufficient role or entity scope.
        404: Snapshot not found.
        409: Snapshot is not in STAGED status (already published or discarded).
    """
    return discard_snapshot(
        db=session,
        snapshot_id=snapshot_id,
        body=body or DiscardRequest(),
        current_user=current_user,
    )


# ---------------------------------------------------------------------------
# GET /snapshots — list recent snapshots (S1 "Recent uploads")
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=SnapshotListResponse,
    status_code=200,
    summary="List recent snapshots (S1 Recent uploads)",
    tags=["snapshots"],
)
def list_snapshots(
    entity_code: Annotated[
        str | None, Query(description="Filter by entity code: IND or UAE")
    ] = None,
    status: Annotated[
        list[str] | None,
        Query(description="Filter by status: STAGED, PUBLISHED, DISCARDED"),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> SnapshotListResponse:
    """Return paginated list of snapshots for the Recent uploads table.

    RBAC:
    - ADMIN: sees any entity.
    - CFO: sees any entity (read-only).
    - ANALYST: sees own entity (entity_id_scope).
    - PENDING: 403.
    """
    from sqlalchemy import func

    query = (
        select(Snapshot, Entity.code.label("entity_code"), User.email.label("uploaded_by_email"))
        .join(Entity, Snapshot.entity_id == Entity.id)
        .join(User, Snapshot.uploaded_by == User.id)
    )

    # ANALYST entity scope
    if current_user.role == Role.ANALYST and current_user.entity_id_scope is not None:
        query = query.where(Snapshot.entity_id == current_user.entity_id_scope)

    if entity_code:
        query = query.where(Entity.code == entity_code)
    if status:
        query = query.where(Snapshot.status.in_(status))

    count_q = select(func.count()).select_from(query.subquery())
    total = session.scalar(count_q) or 0

    rows = session.execute(
        query.order_by(Snapshot.uploaded_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items = [
        SnapshotListRow(
            id=r.Snapshot.id,
            entity_code=r.entity_code,
            source_hint=r.Snapshot.source_hint,
            status=r.Snapshot.status,
            as_of_date=r.Snapshot.as_of_date.isoformat() if r.Snapshot.as_of_date else None,
            uploaded_at=r.Snapshot.uploaded_at,
            uploaded_by_email=r.uploaded_by_email,
            row_count=r.Snapshot.row_count,
            total_outstanding=(
                str(r.Snapshot.total_outstanding)
                if r.Snapshot.total_outstanding is not None
                else None
            ),
        )
        for r in rows
    ]

    return SnapshotListResponse(items=items, total=total, page=page, page_size=page_size)


# ---------------------------------------------------------------------------
# GET /snapshots/{snapshot_id} — snapshot metadata (S2 breadcrumbs)
# ---------------------------------------------------------------------------


@router.get(
    "/{snapshot_id}",
    response_model=SnapshotDetailResponse,
    status_code=200,
    summary="Snapshot metadata (S2 breadcrumbs)",
    tags=["snapshots"],
)
def get_snapshot(
    snapshot_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> SnapshotDetailResponse:
    """Return snapshot metadata only (used by S2 breadcrumbs).

    Returns:
        200 with SnapshotDetailResponse.

    Raises:
        403: ANALYST out-of-scope or PENDING.
        404: Snapshot not found.
    """
    snapshot = session.get(Snapshot, snapshot_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found.")

    # ANALYST entity scope
    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != snapshot.entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this snapshot's entity.",
        )

    entity = session.get(Entity, snapshot.entity_id)
    entity_code = entity.code if entity else "UNKNOWN"

    uploader = session.get(User, snapshot.uploaded_by)
    uploaded_by_email = uploader.email if uploader else ""

    publisher_email: str | None = None
    if snapshot.published_by:
        publisher = session.get(User, snapshot.published_by)
        publisher_email = publisher.email if publisher else None

    return SnapshotDetailResponse(
        id=snapshot.id,
        entity_code=entity_code,
        source_hint=snapshot.source_hint,
        status=snapshot.status,
        as_of_date=snapshot.as_of_date.isoformat() if snapshot.as_of_date else None,
        uploaded_at=snapshot.uploaded_at,
        uploaded_by_email=uploaded_by_email,
        published_at=snapshot.published_at,
        published_by_email=publisher_email,
        published_as=snapshot.published_as,
        row_count=snapshot.row_count,
        total_outstanding=(
            str(snapshot.total_outstanding) if snapshot.total_outstanding is not None else None
        ),
    )


# ---------------------------------------------------------------------------
# GET /snapshots/{snapshot_id}/reconciliation
# POST /snapshots/{snapshot_id}/reconciliation
# ---------------------------------------------------------------------------


@router.get(
    "/{snapshot_id}/reconciliation",
    status_code=200,
    summary="Get or compute reconciliation for a snapshot (A6)",
    tags=["reconciliation"],
)
def get_reconciliation(
    snapshot_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> dict:
    """Fetch existing reconciliation entry or return dry-run (UNRECONCILED) state.

    Returns:
        200 with ReconciliationResponse.

    Raises:
        403: PENDING role.
        404: Snapshot not found.
        409: Snapshot not PUBLISHED.
    """
    from app.services.reconciliation_service import get_or_compute_reconciliation

    return get_or_compute_reconciliation(
        snapshot_id=snapshot_id,
        db=session,
    ).model_dump()


@router.post(
    "/{snapshot_id}/reconciliation",
    status_code=200,
    summary="Create or update reconciliation entry for a snapshot (A6, ADMIN only)",
    tags=["reconciliation"],
)
def upsert_reconciliation(
    snapshot_id: uuid.UUID,
    body: dict,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(require_role(Role.ADMIN))] = ...,  # type: ignore[assignment]
) -> dict:
    """Create or update reconciliation entry for this snapshot. ADMIN only.

    ADMIN-only write is a temporary decision pending resolution of D19 vs §9
    spec contradiction (documented in docs/superpowers/plans/2026-04-18-m4-m6-ship-today.md).

    Body: {tally_xero_closing_ar: Decimal, notes?: str}

    Returns:
        200 with ReconciliationResponse.

    Raises:
        403: Non-ADMIN role.
        404: Snapshot not found.
        409: Snapshot not PUBLISHED.
    """
    from decimal import Decimal

    from app.schemas.reconciliation import ReconciliationCreateRequest
    from app.services.reconciliation_service import create_or_update_reconciliation

    try:
        req = ReconciliationCreateRequest(
            tally_xero_closing_ar=Decimal(str(body.get("tally_xero_closing_ar", 0))),
            notes=body.get("notes"),
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    return create_or_update_reconciliation(
        snapshot_id=snapshot_id,
        body=req,
        current_user=current_user,
        db=session,
    ).model_dump()
