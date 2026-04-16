"""Integration tests for 0002_seed_bootstrap_admin migration.

Validates that bootstrap rows are correctly seeded into the DB by the migration.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

# Mirror of USER_TEJASWA_ID in 0002_seed_bootstrap_admin.py.
# Keep in sync if that constant ever changes.
_USER_TEJASWA_ID = "3805b9d4-906a-4da9-a0b8-aca542e62ba4"

if TYPE_CHECKING:
    # Session is only referenced as a type annotation. With
    # `from __future__ import annotations` in effect, annotations are evaluated
    # lazily (PEP 563), so this import is never executed at runtime. Pytest
    # resolves fixtures by parameter name, not annotation type.
    from sqlalchemy.orm import Session


def test_entities_seeded_ind_uae(db_session: Session) -> None:
    """Confirm exactly 2 entities exist with correct field values."""
    result = db_session.execute(
        text(
            "SELECT code, name, country, base_currency, default_credit_days "
            "FROM entities ORDER BY code"
        )
    ).fetchall()

    # Exactly 2 entities — no extras, no duplicates.
    assert len(result) == 2, f"Expected 2 entities, got {len(result)}: {[r[0] for r in result]}"

    codes = [row[0] for row in result]
    assert "IND" in codes, "IND entity not found"
    assert "UAE" in codes, "UAE entity not found"

    # IND details
    ind_row = next(row for row in result if row[0] == "IND")
    assert ind_row[1] == "EMB Global India", f"IND name mismatch: {ind_row[1]!r}"
    assert ind_row[2] == "IN", f"IND country mismatch: {ind_row[2]!r}"
    assert ind_row[3] == "INR", f"IND currency mismatch: {ind_row[3]!r}"
    assert ind_row[4] is None, "IND default_credit_days should be NULL (set via admin config, spec D8)"

    # UAE details
    uae_row = next(row for row in result if row[0] == "UAE")
    assert "MANTARAV DIGITAL" in uae_row[1], f"UAE name mismatch: {uae_row[1]!r}"
    assert uae_row[2] == "AE", f"UAE country mismatch: {uae_row[2]!r}"
    assert uae_row[3] == "AED", f"UAE currency mismatch: {uae_row[3]!r}"
    assert uae_row[4] is None, "UAE default_credit_days should be NULL (set via admin config, spec D8)"


def test_user_tejaswa_seeded_admin(db_session: Session) -> None:
    """Confirm exactly one Tejaswa ADMIN user exists with correct properties."""
    results = db_session.execute(
        text(
            "SELECT email, name, role, entity_id_scope, is_active "
            "FROM users WHERE email = 'tejaswa.sharma@emb.global'"
        )
    ).fetchall()

    assert len(results) == 1, f"Expected 1 Tejaswa user, got {len(results)}"
    email, name, role, entity_id_scope, is_active = results[0]

    assert email == "tejaswa.sharma@emb.global"
    assert name == "Tejaswa Sharma", f"Name mismatch: {name!r}"
    assert role == "ADMIN", f"Role should be ADMIN, got {role!r}"
    assert entity_id_scope is None, "ADMIN should have entity_id_scope=NULL (all entities)"
    assert is_active is True, "Bootstrap ADMIN should be active"


def test_audit_log_user_bootstrap_create(db_session: Session) -> None:
    """Confirm audit_log has exactly one user_bootstrap_create row with correct fields."""
    results = db_session.execute(
        text(
            "SELECT action, entity_type, actor_user_id, entity_id, after "
            "FROM audit_log WHERE action = 'user_bootstrap_create'"
        )
    ).fetchall()

    assert len(results) == 1, f"Expected 1 bootstrap audit row, got {len(results)}"
    action, entity_type, actor_user_id, entity_id, after_json = results[0]

    assert action == "user_bootstrap_create"
    assert entity_type == "users"
    assert actor_user_id is None, "Bootstrap should have actor_user_id=NULL (system action)"
    assert str(entity_id) == _USER_TEJASWA_ID, (
        f"entity_id should be Tejaswa's UUID {_USER_TEJASWA_ID}, got {entity_id}"
    )

    # psycopg returns JSONB columns as Python dicts; if this were a string the
    # next assertion would raise TypeError, not AssertionError.
    assert isinstance(after_json, dict), f"Expected JSONB dict, got {type(after_json)}"
    assert after_json["email"] == "tejaswa.sharma@emb.global"
    assert after_json["role"] == "ADMIN"
    assert after_json["source"] == "bootstrap_migration"
