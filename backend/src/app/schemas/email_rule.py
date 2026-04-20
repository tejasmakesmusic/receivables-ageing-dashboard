"""Pydantic schemas for email_rules table (Task A.3).

EmailRuleRow      — full row, response model.
EmailRulePatchRequest — partial update; rule_type is NOT patchable (identity is
    selected via path param and the column has a UNIQUE constraint).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, field_validator

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

# Basic email regex — no external deps; matches spec "xxx@yyy.zz".
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
)

EntityFilterLiteral = Literal["IND", "UAE", "ALL"]


def _validate_email(value: str) -> str:
    if not _EMAIL_RE.match(value.strip()):
        raise ValueError(f"Invalid email address: {value!r}")
    return value.strip().lower()


class EmailRuleRow(BaseModel):
    """Full row returned from GET /admin/email-rules."""

    model_config = ConfigDict(frozen=True)

    id: UUID
    rule_type: str
    recipients_json: list[str]
    cron_schedule: str | None
    is_active: bool
    entity_filter: EntityFilterLiteral | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    updated_by: UUID | None


class EmailRuleListResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[EmailRuleRow]
    total: int


class EmailRulePatchRequest(BaseModel):
    """Partial update for PATCH /admin/email-rules/{id}.

    rule_type is intentionally excluded — it is the immutable identity of a
    rule and is selected via the path param.  Supplying it in the body is
    silently ignored (extra fields are dropped by Pydantic v2 default).
    """

    recipients_json: list[str] | None = None
    cron_schedule: str | None = None
    is_active: bool | None = None
    entity_filter: EntityFilterLiteral | None = None
    notes: str | None = None

    @field_validator("recipients_json")
    @classmethod
    def validate_recipients(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return [_validate_email(email) for email in v]
