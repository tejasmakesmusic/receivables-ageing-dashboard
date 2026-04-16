"""Integration tests for 0002_seed_bootstrap_admin migration.

Validates that bootstrap rows are correctly seeded into the DB by the migration.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def test_entities_seeded_ind_uae(db_session: Session) -> None:
    """Confirm IND and UAE entities exist with correct codes."""
    result = db_session.execute(
        text("SELECT code, name, country, base_currency FROM entities ORDER BY code")
    ).fetchall()

    codes = [row[0] for row in result]
    assert "IND" in codes, "IND entity not found"
    assert "UAE" in codes, "UAE entity not found"

    # Check IND details
    ind_row = next((row for row in result if row[0] == "IND"), None)
    assert ind_row is not None
    assert ind_row[1] == "EMB Global India"
    assert ind_row[2] == "IN"
    assert ind_row[3] == "INR"

    # Check UAE details
    uae_row = next((row for row in result if row[0] == "UAE"), None)
    assert uae_row is not None
    assert "MANTARAV DIGITAL" in uae_row[1]
    assert uae_row[2] == "AE"
    assert uae_row[3] == "AED"


def test_user_tejaswa_seeded_admin(db_session: Session) -> None:
    """Confirm Tejaswa ADMIN user exists with correct properties."""
    result = db_session.execute(
        text(
            "SELECT email, name, role, entity_id_scope, is_active "
            "FROM users WHERE email = 'tejaswa.sharma@emb.global'"
        )
    ).fetchone()

    assert result is not None, "Tejaswa user not found"
    email, name, role, entity_id_scope, is_active = result

    assert email == "tejaswa.sharma@emb.global"
    assert name == "Tejaswa Sharma"
    assert role == "ADMIN"
    assert entity_id_scope is None, "ADMIN should have entity_id_scope=NULL"
    assert is_active is True


def test_audit_log_user_bootstrap_create(db_session: Session) -> None:
    """Confirm audit_log has user_bootstrap_create action row."""
    result = db_session.execute(
        text(
            "SELECT action, entity_type, actor_user_id, after "
            "FROM audit_log WHERE action = 'user_bootstrap_create'"
        )
    ).fetchone()

    assert result is not None, "audit_log bootstrap entry not found"
    action, entity_type, actor_user_id, after_json = result

    assert action == "user_bootstrap_create"
    assert entity_type == "users"
    assert actor_user_id is None, "Bootstrap should have actor_user_id=NULL"
    assert after_json is not None
    assert after_json["email"] == "tejaswa.sharma@emb.global"
    assert after_json["role"] == "ADMIN"
    assert after_json["source"] == "bootstrap_migration"
