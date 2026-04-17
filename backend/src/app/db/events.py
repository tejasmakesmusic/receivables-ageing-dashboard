"""SQLAlchemy event hooks — app-layer invariants enforced at ORM boundary.

D15: fx_rates are immutable after insert. The ORM `before_flush` hook here
blocks UPDATEs that go through the unit-of-work path (`session.merge`,
attribute mutation, etc.).

IMPORTANT — this hook does NOT catch Core-style bulk UPDATE paths:
- `session.execute(update(FxRate).values(...))`
- `session.query(FxRate).update({...})`

Those bypass the ORM identity map and never touch `before_flush`. For a
belt-and-suspenders D15 defence, Task 7 migration should add a Postgres
`BEFORE UPDATE` trigger on `fx_rates` that raises an exception. The hook
here is fast feedback for ORM code paths; the trigger is the backstop.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.db.models.fx_rate import FxRate


class FxRateImmutableError(RuntimeError):
    """Raised when an UPDATE on an fx_rates row reaches flush."""


@event.listens_for(Session, "before_flush")
def _block_fx_rate_update(session: Session, flush_context: object, instances: object) -> None:
    for obj in session.dirty:
        if isinstance(obj, FxRate) and session.is_modified(obj, include_collections=False):
            raise FxRateImmutableError(
                f"fx_rates row {obj.id} is immutable (D15). "
                "Insert a new row with a new effective_from instead."
            )


def register_events() -> None:
    """Explicit no-op — importing this module registers the listener.

    Called from app/main.py at startup to make the dependency obvious.
    """
