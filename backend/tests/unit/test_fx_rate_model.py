"""FxRate model — columns + uniqueness + app-layer immutability hook (D15)."""

from __future__ import annotations

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
