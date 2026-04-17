"""Entity model — covers column shape only (CRUD tested in integration)."""

from __future__ import annotations

from app.db.models.entity import Entity


def test_entity_has_required_columns() -> None:
    cols = {c.name for c in Entity.__table__.columns}
    expected = {
        "id",
        "code",
        "name",
        "country",
        "base_currency",
        "default_credit_days",
        "created_at",
        "updated_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_entity_code_is_unique() -> None:
    col = Entity.__table__.c.code
    assert col.unique is True


def test_entity_default_credit_days_nullable() -> None:
    # Spec D8: admin sets credit period — no default at schema level.
    col = Entity.__table__.c.default_credit_days
    assert col.nullable is True
