"""Role-based access control middleware (spec D5).

Roles: ANALYST (entity-scoped), CFO (read all), ADMIN (everything +
publish override), PENDING (zero perms — lands on /pending).

Every endpoint gets an explicit `require_role(...)` or `require_scope(...)`
dependency. No implicit access. Implementation lands in Milestone 1.
"""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    # IMPORTANT — adding or renaming a value here requires a HAND-WRITTEN
    # Alembic migration that emits `ALTER TYPE role_enum ADD VALUE '...'`
    # (or a DROP + CREATE + data backfill for renames). `alembic revision
    # --autogenerate` does NOT detect changes to native Postgres enum types
    # and will silently produce a no-op migration. Removing a value is
    # even more involved — it requires recreating the type, updating every
    # column that references it, and backfilling. See User.role in
    # backend/src/app/db/models/user.py for the native-enum column.
    ANALYST = "ANALYST"
    CFO = "CFO"
    ADMIN = "ADMIN"
    PENDING = "PENDING"
