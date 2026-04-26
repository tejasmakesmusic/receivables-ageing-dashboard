"""Exception note service — list/create notes on exception tags."""

from __future__ import annotations

import uuid  # noqa: TCH003
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import structlog
from fastapi import HTTPException
from sqlalchemy import select

from app.db.models.audit_log import AuditLog
from app.db.models.exception_note import ExceptionNote
from app.db.models.exception_tag import ExceptionTag
from app.db.models.user import User
from app.schemas.exception_note import (
    ExceptionNoteCreateRequest,
    ExceptionNoteListResponse,
    ExceptionNoteRow,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User as UserModel

log = structlog.get_logger(__name__)


def list_notes(
    exception_id: uuid.UUID,
    db: Session,
) -> ExceptionNoteListResponse:
    """List all notes for an exception tag in chronological order."""
    rows = db.execute(
        select(ExceptionNote, User.email.label("author_email"))
        .outerjoin(User, ExceptionNote.author_user_id == User.id)
        .where(ExceptionNote.exception_tag_id == exception_id)
        .order_by(ExceptionNote.created_at.asc())
    ).all()

    items = [
        ExceptionNoteRow(
            id=row[0].id,
            exception_tag_id=row[0].exception_tag_id,
            body=row[0].body,
            author_email=row[1],
            created_at=row[0].created_at,
        )
        for row in rows
    ]

    return ExceptionNoteListResponse(items=items, total=len(items))


def create_note(
    exception_id: uuid.UUID,
    body: ExceptionNoteCreateRequest,
    current_user: UserModel,
    db: Session,
) -> ExceptionNoteRow:
    """Create and persist a new note for an exception tag."""
    tag = db.get(ExceptionTag, exception_id)
    if tag is None:
        raise HTTPException(status_code=404, detail=f"Exception tag {exception_id} not found.")

    now_utc = datetime.now(tz=UTC)
    note = ExceptionNote(
        exception_tag_id=exception_id,
        body=body.body,
        author_user_id=current_user.id,
        created_at=now_utc,
    )
    db.add(note)
    db.flush()

    db.add(
        AuditLog(
            action="EXCEPTION_NOTE_CREATED",
            entity_type="exception_notes",
            entity_id=note.id,
            actor_user_id=current_user.id,
            before=None,
            after={
                "exception_tag_id": str(exception_id),
                "note_id": str(note.id),
            },
        )
    )
    db.commit()
    db.refresh(note)

    log.info(
        "exception_note_service.create_note",
        exception_id=str(exception_id),
        note_id=str(note.id),
    )

    return ExceptionNoteRow(
        id=note.id,
        exception_tag_id=note.exception_tag_id,
        body=note.body,
        author_email=current_user.email,
        created_at=note.created_at,
    )
