"""SQLAlchemy event hooks — app-layer invariants enforced at ORM boundary.

D15: fx_rates are immutable after insert. DB UPDATE is blocked here rather
than via a trigger so that migrations and Neon branches stay cheap.
"""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.db.models.fx_rate import FxRate


class FxRateImmutableError(RuntimeError):
    """Raised when an UPDATE on an fx_rates row reaches flush."""


@event.listens_for(Session, "before_flush")
def _block_fx_rate_update(session: Session, flush_context, instances) -> None:  # noqa: ARG001, ANN001
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
