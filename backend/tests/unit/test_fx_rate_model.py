"""FxRate model — columns + uniqueness + app-layer immutability hook (D15)."""

from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session

# Importing `app.db` registers the D15 immutability listener as a side
# effect (via app/db/__init__.py). Tests assume the hook is active.
import app.db  # noqa: F401
from app.db.events import _block_fx_rate_update
from app.db.models.fx_rate import FxRate


def test_fx_rate_columns() -> None:
    cols = {c.name for c in FxRate.__table__.columns}
    expected = {
        "id",
        "from_ccy",
        "to_ccy",
        "rate",
        "effective_from",
        "effective_to",
        "source",
        "created_at",
        "created_by",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_fx_rate_unique_triple() -> None:
    # (from_ccy, to_ccy, effective_from) is unique — prevents overlap.
    uq_sets = [
        set(c.columns.keys())
        for c in FxRate.__table__.constraints
        if c.__class__.__name__ == "UniqueConstraint"
    ]
    assert {"from_ccy", "to_ccy", "effective_from"} in uq_sets


def test_fx_rate_source_is_enum() -> None:
    col = FxRate.__table__.c.source
    assert col.type.__class__.__name__ == "Enum"


def test_d15_immutability_listener_is_registered() -> None:
    # Regression guard: the D15 fx_rates immutability hook must be a
    # registered before_flush listener on Session as soon as app.db is
    # imported. If someone accidentally unwires app/db/__init__.py or
    # renames the listener, this test fails fast — integration tests
    # (Task 6B) would otherwise pass silently with D15 disabled.
    assert event.contains(Session, "before_flush", _block_fx_rate_update)
