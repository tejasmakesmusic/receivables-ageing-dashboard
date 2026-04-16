"""M2 seed bootstrap admin — IND/UAE entities + Tejaswa ADMIN.

Revision ID: 0002_seed_bootstrap_admin
Revises: 0001_initial
Create Date: 2026-04-16

Rollback note: Downgrade deletes the 3 seed rows by hardcoded UUID — safe only if no
downstream FK rows reference them (i.e. this is the initial bootstrap and no uploads
have occurred).
"""

from __future__ import annotations

import json
from uuid import UUID

from alembic import op

# Hardcoded UUIDs for deterministic, referenceable bootstrap rows.
# Generated via uuid.uuid4() to ensure uniqueness.
ENTITY_IND_ID = UUID("600e57f5-8718-4517-9c99-cf56d4bd7a51")
ENTITY_UAE_ID = UUID("470295c1-8709-435d-a695-101d9d986db2")
USER_TEJASWA_ID = UUID("3805b9d4-906a-4da9-a0b8-aca542e62ba4")
AUDIT_LOG_ID = UUID("f400e60e-c6fe-4dda-bf1c-13d07ebf1dd4")

# revision identifiers, used by Alembic
revision = "0002_seed_bootstrap_admin"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ========================================================================
    # Insert two entities (IND and UAE) in dependency order
    # ========================================================================
    op.execute(
        f"""
        INSERT INTO entities (id, code, name, country, base_currency, default_credit_days, created_at, updated_at)
        VALUES (
            '{ENTITY_IND_ID}'::uuid,
            'IND',
            'EMB Global India',
            'IN',
            'INR',
            NULL,
            NOW(),
            NOW()
        );
        """
    )

    op.execute(
        f"""
        INSERT INTO entities (id, code, name, country, base_currency, default_credit_days, created_at, updated_at)
        VALUES (
            '{ENTITY_UAE_ID}'::uuid,
            'UAE',
            'MANTARAV DIGITAL INFORMATION TECHNOLOGY CONSULTANCY — SOLE PROPRIETORSHIP L.L.C.',
            'AE',
            'AED',
            NULL,
            NOW(),
            NOW()
        );
        """
    )

    # ========================================================================
    # Insert Tejaswa ADMIN user (entity_id_scope=NULL for ADMIN)
    # ========================================================================
    op.execute(
        f"""
        INSERT INTO users (id, email, google_sub, name, role, entity_id_scope, is_active, created_at, updated_at, last_login_at)
        VALUES (
            '{USER_TEJASWA_ID}'::uuid,
            'tejaswa.sharma@emb.global',
            NULL,
            'Tejaswa Sharma',
            'ADMIN',
            NULL,
            TRUE,
            NOW(),
            NOW(),
            NULL
        );
        """
    )

    # ========================================================================
    # Insert audit_log row for user bootstrap (actor_user_id=NULL for system)
    # ========================================================================
    after_json = json.dumps({
        "email": "tejaswa.sharma@emb.global",
        "role": "ADMIN",
        "source": "bootstrap_migration"
    })
    op.execute(
        f"""
        INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, before, after, created_at)
        VALUES (
            '{AUDIT_LOG_ID}'::uuid,
            NULL,
            'user_bootstrap_create',
            'users',
            '{USER_TEJASWA_ID}'::uuid,
            NULL,
            '{after_json}'::jsonb,
            NOW()
        );
        """
    )


def downgrade() -> None:
    # ========================================================================
    # Delete in reverse dependency order: audit_log → users → entities
    # ========================================================================
    op.execute(
        f"""
        DELETE FROM audit_log WHERE id = '{AUDIT_LOG_ID}'::uuid;
        """
    )

    op.execute(
        f"""
        DELETE FROM users WHERE id = '{USER_TEJASWA_ID}'::uuid;
        """
    )

    op.execute(
        f"""
        DELETE FROM entities WHERE id IN ('{ENTITY_IND_ID}'::uuid, '{ENTITY_UAE_ID}'::uuid);
        """
    )
