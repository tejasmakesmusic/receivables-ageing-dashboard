"""Discard service — POST /snapshots/:id/discard (M3 Task 6).

Implements the transactional discard flow (spec §5).

Public interface::

    discard_snapshot(db, snapshot_id, body, current_user) -> DiscardResponse

Design decisions:
- ONE db.commit() at the end. All steps mutate in-memory.
- SELECT FOR UPDATE prevents concurrent state transitions.
- DISCARDED is a terminal state; already-published/discarded → 409.
- Audit log written on every discard (CLAUDE.md rule).
- No raw party names in structlog.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import structlog
from fastapi import HTTPException
from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.snapshot import Snapshot
from app.schemas.discard import DiscardRequest, DiscardResponse
from app.schemas.publish import UserRef

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.orm import Session

    from app.db.models.user import User

log = structlog.get_logger(__name__)


def discard_snapshot(
    db: Session,
    snapshot_id: uuid.UUID,
    body: DiscardRequest,
    current_user: User,
) -> DiscardResponse:
    """Transition a STAGED snapshot to DISCARDED.

    Steps:
    1. Load snapshot with SELECT FOR UPDATE.
    2. RBAC check: ANALYST (entity-scoped) or ADMIN. CFO/PENDING → 403.
    3. Validate state: must be STAGED → else 409.
    4. Transition status to DISCARDED.
    5. Write audit_log row.
    6. Commit.
    7. Return DiscardResponse.

    Raises:
        403: CFO/PENDING role, or ANALYST wrong entity scope.
        404: Snapshot not found.
        409: Snapshot is not in STAGED status.
    """
    now_utc = datetime.now(tz=UTC)

    # ------------------------------------------------------------------
    # Step 1: Load with row-level lock
    # ------------------------------------------------------------------
    snapshot = db.scalar(select(Snapshot).where(Snapshot.id == snapshot_id).with_for_update())
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found.")

    # ------------------------------------------------------------------
    # Step 2: RBAC + entity scope
    # ------------------------------------------------------------------
    if current_user.role in (Role.CFO, Role.PENDING):
        raise HTTPException(status_code=403, detail="Insufficient permissions to discard.")

    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != snapshot.entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this entity.",
        )

    # ------------------------------------------------------------------
    # Step 3: Validate state
    # ------------------------------------------------------------------
    if snapshot.status != "STAGED":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "SNAPSHOT_NOT_STAGED",
                "snapshot_status": snapshot.status,
                "detail": "Only STAGED snapshots can be discarded.",
            },
        )

    # ------------------------------------------------------------------
    # Step 4: Transition
    # ------------------------------------------------------------------
    snapshot.status = "DISCARDED"
    snapshot.discarded_at = now_utc
    snapshot.discarded_by = current_user.id

    # ------------------------------------------------------------------
    # Step 5: Audit log
    # ------------------------------------------------------------------
    audit = AuditLog(
        action="snapshot.discard",
        entity_type="snapshots",
        entity_id=snapshot.id,
        actor_user_id=current_user.id,
        before={"status": "STAGED"},
        after={
            "status": "DISCARDED",
            "reason": body.reason,
            "discarded_by": str(current_user.id),
        },
    )
    db.add(audit)

    # ------------------------------------------------------------------
    # Step 6: Commit
    # ------------------------------------------------------------------
    db.commit()

    log.info(
        "discard_service.discard_snapshot",
        snapshot_id=str(snapshot_id),
        entity_id=str(snapshot.entity_id),
    )

    # ------------------------------------------------------------------
    # Step 7: Return
    # ------------------------------------------------------------------
    return DiscardResponse(
        snapshot_id=snapshot.id,
        status="DISCARDED",
        discarded_at=now_utc,
        discarded_by=UserRef(id=current_user.id, email=current_user.email),
        reason=body.reason,
    )
