"""Role-based access control middleware (spec D5).

Roles: ANALYST (entity-scoped), CFO (read all), ADMIN (everything +
publish override), PENDING (zero perms — lands on /pending).

Every endpoint gets an explicit `require_role(...)` or `require_scope(...)`
dependency. No implicit access. Implementation lands in Milestone 1.
"""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    ANALYST = "ANALYST"
    CFO = "CFO"
    ADMIN = "ADMIN"
    PENDING = "PENDING"
