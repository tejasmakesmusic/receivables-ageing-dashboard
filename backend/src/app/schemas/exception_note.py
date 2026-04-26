"""Exception note schemas for exception note timeline (M5 extension)."""

from __future__ import annotations

from datetime import datetime  # noqa: TCH003
from uuid import UUID  # noqa: TCH003

from pydantic import BaseModel, ConfigDict, field_validator


class ExceptionNoteCreateRequest(BaseModel):
    body: str

    _MAX_BODY_CHARS = 5000

    @field_validator("body")
    @classmethod
    def validate_body(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("body must not be empty")
        if len(v) > cls._MAX_BODY_CHARS:
            raise ValueError("body must be 5000 characters or fewer")
        return v


class ExceptionNoteRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    exception_tag_id: UUID
    body: str
    author_email: str | None
    created_at: datetime


class ExceptionNoteListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[ExceptionNoteRow]
    total: int
