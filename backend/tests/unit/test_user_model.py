"""User model — columns + Role enum + FK to entities."""

from __future__ import annotations

from app.core.rbac import Role
from app.db.models.user import User


def test_user_has_required_columns() -> None:
    cols = {c.name for c in User.__table__.columns}
    expected = {
        "id",
        "email",
        "google_sub",
        "name",
        "role",
        "entity_id_scope",
        "is_active",
        "created_at",
        "updated_at",
        "last_login_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_user_email_unique() -> None:
    assert User.__table__.c.email.unique is True


def test_user_google_sub_unique_and_nullable() -> None:
    col = User.__table__.c.google_sub
    assert col.unique is True
    assert col.nullable is True


def test_user_role_defaults_to_pending() -> None:
    # Spec §13 consequence #7 — new users are PENDING by default.
    col = User.__table__.c.role
    assert col.default.arg == Role.PENDING


def test_user_entity_id_scope_fk_nullable() -> None:
    col = User.__table__.c.entity_id_scope
    assert col.nullable is True
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "entities"
