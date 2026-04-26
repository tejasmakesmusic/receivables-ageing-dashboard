"""Pydantic v2 schemas for GET /snapshots/:id/cp-diff (Task 15).

Describes the read-only diff between a CREDIT_PERIOD snapshot's parsed rows
and the currently-active credit_period_config rows.

Three categories per ADR-0005 D3:
  ADDED      — no active config for this canonical+entity → will INSERT on publish.
  SUPERSEDED — active config exists but days or reason_note differs → will supersede.
  UNCHANGED  — active config exactly matches (same days + reason_note) → no-op.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class CpDiffEntry(BaseModel):
    """One row in the diff result.

    ``prior_days`` and ``prior_reason_note`` are populated for SUPERSEDED rows
    (the values that would be closed on publish).  For ADDED rows both are None.
    For UNCHANGED rows they equal ``days`` and ``reason_note``.
    """

    model_config = ConfigDict(frozen=True)

    canonical_name: str
    entity_code: str
    days: int
    reason_note: str | None
    # Only set for SUPERSEDED / UNCHANGED — the current active config values.
    prior_days: int | None = None
    prior_reason_note: str | None = None


class CpDiffResponse(BaseModel):
    """Response shape for GET /snapshots/{snapshot_id}/cp-diff.

    Each list is independent; a client name will appear in at most one list.
    """

    model_config = ConfigDict(frozen=True)

    snapshot_id: str
    added: list[CpDiffEntry]
    superseded: list[CpDiffEntry]
    unchanged: list[CpDiffEntry]
