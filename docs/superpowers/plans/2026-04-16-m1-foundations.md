# M1 Foundations + Deploy Skeleton — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land DB schema (4 tables), Google SSO with domain lock, four-role RBAC, PENDING admin-approval flow, and `/health` deployed to Railway. Terminal state of this plan: ADMIN can sign in via Google, promote PENDING users to ANALYST/CFO/ADMIN with audit trail, every write has tests, all in one uvicorn process on Railway pointing at Neon.

**Architecture:** FastAPI + SQLAlchemy 2 on Railway (uvicorn workers=1, spec §11). Neon Postgres via pooled DSN at runtime and direct DSN for Alembic (pgbouncer strips session statements). Auth is pluggable (`AUTH_PROVIDER=google|stub`) via authlib. Sessions are signed cookies (itsdangerous), 12h idle. Build slicing: day 1 = migrations + `/health` deployed, day 2 = SSO end-to-end, day 3 = RBAC + admin endpoints + DNS ping.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, pydantic v2, authlib, itsdangerous, structlog, psycopg3, pytest, Neon Postgres, Railway.

**Spec:** [`docs/superpowers/specs/2026-04-16-m1-foundations-design.md`](../specs/2026-04-16-m1-foundations-design.md)
**Locked decisions:** `02_HANDOFF_SPEC.md` §2 D1–D23
**Guardrails:** `CLAUDE.md`

---

## File Structure

### New files

**Migrations**
- `backend/alembic/versions/0001_initial.py` — entities, users, fx_rates, audit_log
- `backend/alembic/versions/0002_seed_bootstrap_admin.py` — seed entities + Tejaswa as ADMIN

**DB models** (one file per table, kept small for isolation)
- `backend/src/app/db/models/__init__.py` — re-exports + `Base`
- `backend/src/app/db/models/base.py` — declarative `Base`, shared mixins (`TimestampMixin`, `UUIDPrimaryKeyMixin`)
- `backend/src/app/db/models/entity.py`
- `backend/src/app/db/models/user.py` — also hosts the `Role` SA enum mapping
- `backend/src/app/db/models/fx_rate.py`
- `backend/src/app/db/models/audit_log.py`
- `backend/src/app/db/events.py` — SQLAlchemy event hook enforcing `fx_rates` immutability (D15)

**Schemas** (pydantic v2 request/response)
- `backend/src/app/schemas/__init__.py`
- `backend/src/app/schemas/user.py` — `UserOut`, `MeOut`, `UserUpdateIn`
- `backend/src/app/schemas/entity.py` — `EntityOut`

**Core**
- `backend/src/app/core/auth.py` — `AuthProvider` protocol, `GoogleAuthProvider`, `StubAuthProvider`, `get_auth_provider()` factory, `GoogleUserInfo` pydantic model
- `backend/src/app/core/audit.py` — `write_audit_log(session, actor_id, action, entity_type, entity_id, before, after)` helper
- `backend/src/app/core/startup.py` — `validate_config()` fail-fast guard called on app boot

**API**
- `backend/src/app/api/routers/__init__.py`
- `backend/src/app/api/routers/health.py` — `/health` with DB ping
- `backend/src/app/api/routers/auth.py` — `/auth/google/login`, `/auth/google/callback`, `/auth/logout`, `/auth/me`
- `backend/src/app/api/routers/admin.py` — `GET /admin/users`, `PATCH /admin/users/{id}`

**Tests**
- `backend/tests/conftest.py` — extend with `client`, `db`, `stub_signed_in_user(role)` fixtures (file already exists with base scaffolding)
- `backend/tests/unit/test_rbac.py`
- `backend/tests/unit/test_auth_provider.py`
- `backend/tests/unit/test_schemas.py`
- `backend/tests/unit/test_session_idle.py`
- `backend/tests/integration/test_health.py`
- `backend/tests/integration/test_auth_flow.py`
- `backend/tests/integration/test_admin_users.py`
- `backend/tests/integration/test_migrations.py`

**Deploy**
- `Dockerfile` — multi-stage, Python 3.12-slim, uv to install, uvicorn as entrypoint
- `.dockerignore`
- `railway.toml` — build + healthcheck config
- `scripts/smoke_prod.sh` — post-deploy `/health` curl

### Modified files

- `backend/src/app/config.py` — add `auth_provider: Literal["google","stub"]`
- `backend/src/app/core/rbac.py` — extend with `require_role(...)` factory
- `backend/src/app/api/deps.py` — add `get_current_user`
- `backend/src/app/main.py` — mount middleware, include routers, call startup guards
- `backend/src/app/db/session.py` — no change planned (confirmed compatible)
- `pyproject.toml` — no new deps needed (authlib/itsdangerous already present)
- `README.md` — tick M1 completion checklist at end

---

## Task List Overview

**Day 1 — Migrations + /health + Deploy Skeleton**
- Task 1: Config additions (`auth_provider` setting)
- Task 2: DB model base + mixins
- Task 3: Entity model
- Task 4: User model + Role mapping
- Task 5: FxRate model + immutability event hook
- Task 6: AuditLog model
- Task 6B: Test DB fixtures (conftest `db_session` + per-test transaction)
- Task 7: `0001_initial.py` migration (up + down)
- Task 8: `0002_seed_bootstrap_admin.py` migration
- Task 9: `/health` router with DB ping
- Task 10: Dockerfile + railway.toml + smoke script
- Task 11: Deploy `/health` to Railway + run smoke

**Day 2 — SSO**
- Task 12: Session middleware wiring + startup config guard
- Task 13: `AuthProvider` protocol + `StubAuthProvider`
- Task 14: `GoogleAuthProvider` + factory
- Task 15: pydantic schemas (`UserOut`, `MeOut`, `UserUpdateIn`, `EntityOut`)
- Task 16: `get_current_user` dependency + 12h idle enforcement
- Task 17: `/auth/google/login` + `/auth/logout` + `/auth/me`
- Task 18: `/auth/google/callback` (upsert + domain lock + audit_log)
- Task 19: Deploy preview + manual Google SSO smoke

**Day 3 — RBAC + Admin + Wrap**
- Task 20: `require_role` RBAC factory
- Task 21: `write_audit_log` helper
- Task 22: `GET /admin/users`
- Task 23: `PATCH /admin/users/{id}` + validations
- Task 24: Full-stack Railway deploy + smoke
- Task 25: IT ping for SPF+DKIM on `emb.global`
- Task 26: Coverage check + README tick + final commit

---

## Day 1 — Migrations + /health + Deploy Skeleton

### Task 1: Config additions

**Files:**
- Modify: `backend/src/app/config.py`
- Test: `backend/tests/unit/test_config.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_config.py`:

```python
"""Config tests — ensure new M1 settings are present and typed."""

from __future__ import annotations

import pytest

from app.config import Settings


def test_auth_provider_defaults_to_stub_in_dev() -> None:
    s = Settings(app_env="development")
    assert s.auth_provider == "stub"


def test_auth_provider_accepts_google() -> None:
    s = Settings(auth_provider="google")
    assert s.auth_provider == "google"


def test_auth_provider_rejects_unknown() -> None:
    with pytest.raises(ValueError):
        Settings(auth_provider="facebook")  # type: ignore[arg-type]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest backend/tests/unit/test_config.py -v`
Expected: FAIL — `auth_provider` attribute missing on `Settings`.

- [ ] **Step 3: Add the setting**

Edit `backend/src/app/config.py`, after the `# ---- Google Workspace SSO (D4) ----` block and before `# ---- Email provider (D22) ----`, add:

```python
    # ---- Auth provider toggle (M1) ----
    # "stub" is for local dev + tests only. Startup guard raises if stub is
    # selected in production — see app/core/startup.py.
    auth_provider: Literal["google", "stub"] = "stub"
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_config.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/config.py backend/tests/unit/test_config.py
git commit -m "feat(config): add AUTH_PROVIDER=google|stub toggle"
```

---

### Task 2: DB model base + mixins

**Files:**
- Create: `backend/src/app/db/models/__init__.py`
- Create: `backend/src/app/db/models/base.py`
- Test: covered by Task 3 (model tests exercise the base)

- [ ] **Step 1: Create the base file**

Create `backend/src/app/db/models/base.py`:

```python
"""Declarative Base + shared mixins for all SQLAlchemy models.

Every model must inherit from Base. Most models also pick up
UUIDPrimaryKeyMixin and TimestampMixin for uniformity.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base — all models subclass this."""


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
        nullable=False,
    )
```

- [ ] **Step 2: Create the package __init__**

Create `backend/src/app/db/models/__init__.py`:

```python
"""Model re-exports so `from app.db.models import User` works."""

from __future__ import annotations

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

__all__ = ["Base", "TimestampMixin", "UUIDPrimaryKeyMixin"]
```

- [ ] **Step 3: Verify import path**

Run: `uv run python -c "from app.db.models import Base; print(Base)"`
Expected: `<class 'sqlalchemy.orm.decl_api.Base'>` (or similar). No error.

- [ ] **Step 4: Commit**

```bash
git add backend/src/app/db/models/
git commit -m "feat(db): declarative Base + UUID/timestamp mixins"
```

---

### Task 3: Entity model

**Files:**
- Create: `backend/src/app/db/models/entity.py`
- Modify: `backend/src/app/db/models/__init__.py`
- Test: `backend/tests/unit/test_entity_model.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_entity_model.py`:

```python
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
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_entity_model.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.db.models.entity'`.

- [ ] **Step 3: Create the model**

Create `backend/src/app/db/models/entity.py`:

```python
"""Entity — a legal entity with its own ledger (EMB_IN, MANTARAV_UAE)."""

from __future__ import annotations

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Entity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "entities"

    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False)  # ISO-2
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)  # INR, AED
    # Nullable — admin sets default credit period per entity in M3 (spec D8).
    default_credit_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def __repr__(self) -> str:
        return f"<Entity {self.code}>"
```

- [ ] **Step 4: Export from package**

Edit `backend/src/app/db/models/__init__.py`:

```python
"""Model re-exports so `from app.db.models import User` works."""

from __future__ import annotations

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.entity import Entity

__all__ = ["Base", "Entity", "TimestampMixin", "UUIDPrimaryKeyMixin"]
```

- [ ] **Step 5: Run test**

Run: `uv run pytest backend/tests/unit/test_entity_model.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/db/models/entity.py backend/src/app/db/models/__init__.py backend/tests/unit/test_entity_model.py
git commit -m "feat(db): entity model (code, country, base_currency, default_credit_days)"
```

---

### Task 4: User model + Role mapping

**Files:**
- Create: `backend/src/app/db/models/user.py`
- Modify: `backend/src/app/db/models/__init__.py`
- Test: `backend/tests/unit/test_user_model.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_user_model.py`:

```python
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
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_user_model.py -v`
Expected: FAIL `ModuleNotFoundError`.

- [ ] **Step 3: Create the model**

Create `backend/src/app/db/models/user.py`:

```python
"""User — one row per human who has ever signed in via Google SSO."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.rbac import Role
from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.entity import Entity


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    # citext in Postgres gives case-insensitive uniqueness. We use a CHECK-free
    # plain VARCHAR here and normalize emails to lowercase at insert time in
    # the auth callback — simpler than requiring the citext extension on Neon.
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    google_sub: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="role_enum", native_enum=True),
        nullable=False,
        default=Role.PENDING,
    )
    entity_id_scope: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    entity_scope: Mapped[Entity | None] = relationship("Entity", lazy="joined")

    def __repr__(self) -> str:
        return f"<User {self.email} role={self.role}>"
```

- [ ] **Step 4: Export from package**

Edit `backend/src/app/db/models/__init__.py`:

```python
"""Model re-exports so `from app.db.models import User` works."""

from __future__ import annotations

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.entity import Entity
from app.db.models.user import User

__all__ = ["Base", "Entity", "TimestampMixin", "UUIDPrimaryKeyMixin", "User"]
```

- [ ] **Step 5: Run test**

Run: `uv run pytest backend/tests/unit/test_user_model.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/db/models/user.py backend/src/app/db/models/__init__.py backend/tests/unit/test_user_model.py
git commit -m "feat(db): user model (email, google_sub, role, entity_id_scope)"
```

---

### Task 5: FxRate model + immutability event hook

**Files:**
- Create: `backend/src/app/db/models/fx_rate.py`
- Create: `backend/src/app/db/events.py`
- Modify: `backend/src/app/db/models/__init__.py`
- Test: `backend/tests/unit/test_fx_rate_model.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_fx_rate_model.py`:

```python
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
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_fx_rate_model.py -v`
Expected: FAIL `ModuleNotFoundError`.

- [ ] **Step 3: Create the model**

Create `backend/src/app/db/models/fx_rate.py`:

```python
"""FX rate — AED→INR (etc.), immutable after create (spec D15).

Immutability is enforced at the app layer via a SQLAlchemy event hook in
`app/db/events.py`. No DB trigger — keeps Neon branches cheap.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class FxRateSource(StrEnum):
    MANUAL = "MANUAL"
    API = "API"


class FxRate(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "fx_rates"
    __table_args__ = (
        UniqueConstraint(
            "from_ccy", "to_ccy", "effective_from", name="uq_fx_rate_triple"
        ),
    )

    from_ccy: Mapped[str] = mapped_column(String(3), nullable=False)
    to_ccy: Mapped[str] = mapped_column(String(3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[FxRateSource] = mapped_column(
        Enum(FxRateSource, name="fx_rate_source", native_enum=True),
        nullable=False,
    )
    # Only created_at (no updated_at) because row is immutable.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    creator: Mapped[User | None] = relationship("User", lazy="joined")
```

- [ ] **Step 4: Create the immutability event hook**

Create `backend/src/app/db/events.py`:

```python
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
```

- [ ] **Step 5: Export from package**

Edit `backend/src/app/db/models/__init__.py`:

```python
"""Model re-exports so `from app.db.models import User` works."""

from __future__ import annotations

from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.entity import Entity
from app.db.models.fx_rate import FxRate, FxRateSource
from app.db.models.user import User

__all__ = [
    "Base",
    "Entity",
    "FxRate",
    "FxRateSource",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
]
```

- [ ] **Step 6: Run tests**

Run: `uv run pytest backend/tests/unit/test_fx_rate_model.py -v`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/db/models/fx_rate.py backend/src/app/db/events.py backend/src/app/db/models/__init__.py backend/tests/unit/test_fx_rate_model.py
git commit -m "feat(db): fx_rate model + app-layer immutability hook (D15)"
```

---

### Task 6: AuditLog model

**Files:**
- Create: `backend/src/app/db/models/audit_log.py`
- Modify: `backend/src/app/db/models/__init__.py`
- Test: `backend/tests/unit/test_audit_log_model.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_audit_log_model.py`:

```python
"""AuditLog model — columns + jsonb before/after + indexed created_at."""

from __future__ import annotations

from app.db.models.audit_log import AuditLog


def test_audit_log_columns() -> None:
    cols = {c.name for c in AuditLog.__table__.columns}
    expected = {
        "id",
        "actor_user_id",
        "action",
        "entity_type",
        "entity_id",
        "before",
        "after",
        "created_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_audit_log_actor_nullable() -> None:
    # System/bootstrap actions have NULL actor.
    assert AuditLog.__table__.c.actor_user_id.nullable is True


def test_audit_log_before_after_jsonb() -> None:
    before = AuditLog.__table__.c.before
    after = AuditLog.__table__.c.after
    # JSONB via postgresql dialect
    assert before.type.__class__.__name__ in {"JSONB", "JSON"}
    assert after.type.__class__.__name__ in {"JSONB", "JSON"}


def test_audit_log_created_at_indexed() -> None:
    idx_cols = {tuple(i.columns.keys()) for i in AuditLog.__table__.indexes}
    assert ("created_at",) in idx_cols
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_audit_log_model.py -v`
Expected: FAIL.

- [ ] **Step 3: Create the model**

Create `backend/src/app/db/models/audit_log.py`:

```python
"""AuditLog — append-only ledger of every mutation (spec §9 + CLAUDE.md rule).

Every role change, FX rate create, ingestion upload, rule activation etc.
writes a row here with before/after JSON snapshots.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.db.models.user import User


class AuditLog(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_created_at", "created_at"),)

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    actor: Mapped[User | None] = relationship("User", lazy="joined")
```

- [ ] **Step 4: Export from package**

Edit `backend/src/app/db/models/__init__.py`:

```python
"""Model re-exports so `from app.db.models import User` works."""

from __future__ import annotations

from app.db.models.audit_log import AuditLog
from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.entity import Entity
from app.db.models.fx_rate import FxRate, FxRateSource
from app.db.models.user import User

__all__ = [
    "AuditLog",
    "Base",
    "Entity",
    "FxRate",
    "FxRateSource",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
]
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest backend/tests/unit/test_audit_log_model.py -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/db/models/audit_log.py backend/src/app/db/models/__init__.py backend/tests/unit/test_audit_log_model.py
git commit -m "feat(db): audit_log model (jsonb before/after, indexed created_at)"
```

---

### Task 6B: Test DB fixtures

The existing `backend/tests/conftest.py` only has a `TestClient` fixture at session scope. Integration tests from Task 8 onwards need a `db_session` fixture with per-test isolation. Strategy: one Neon branch per test session (cheap, Neon creates branches via API in under a second), with each test wrapped in a nested transaction that rolls back at teardown.

**Files:**
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/neon_branch.py` — helper for branch lifecycle

- [ ] **Step 1: Add `neon-api` to dev dependencies**

Edit `pyproject.toml`, add to `[project.optional-dependencies].dev`:

```toml
    "neon-api>=0.2,<1",                 # test-DB branching
```

Run: `uv sync --extra dev`
Expected: `neon-api` installed.

- [ ] **Step 2: Set env vars for test branching**

Add to your local `.env`:

```
NEON_API_KEY=<get from https://console.neon.tech/app/settings/api-keys>
NEON_PROJECT_ID=<from Neon dashboard URL>
NEON_PARENT_BRANCH_ID=<main branch id from Neon dashboard>
```

- [ ] **Step 3: Create branch helper**

Create `backend/tests/neon_branch.py`:

```python
"""Neon branch lifecycle helper for test isolation.

Creates a throwaway branch per test session, yields its DSN, deletes it
on teardown. Falls back to DATABASE_URL_DIRECT if NEON_API_KEY is absent
(useful in CI if you prefer one shared test DB).
"""

from __future__ import annotations

import os
import time
import uuid
from contextlib import contextmanager
from typing import Iterator

import httpx


NEON_API = "https://console.neon.tech/api/v2"


@contextmanager
def neon_branch_dsn() -> Iterator[str]:
    api_key = os.getenv("NEON_API_KEY")
    project_id = os.getenv("NEON_PROJECT_ID")
    parent_id = os.getenv("NEON_PARENT_BRANCH_ID")

    if not (api_key and project_id and parent_id):
        # Fallback: use the configured direct DSN (no isolation, but runs)
        direct = os.environ["DATABASE_URL_DIRECT"]
        yield direct
        return

    headers = {"Authorization": f"Bearer {api_key}"}
    name = f"test-{uuid.uuid4().hex[:8]}"

    # Create branch
    resp = httpx.post(
        f"{NEON_API}/projects/{project_id}/branches",
        headers=headers,
        json={
            "branch": {"name": name, "parent_id": parent_id},
            "endpoints": [{"type": "read_write"}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    branch_id = data["branch"]["id"]

    # Wait for endpoint to be ready
    endpoint_host = data["endpoints"][0]["host"]
    for _ in range(30):
        r = httpx.get(
            f"{NEON_API}/projects/{project_id}/endpoints",
            headers=headers,
            timeout=10,
        )
        r.raise_for_status()
        eps = r.json()["endpoints"]
        if any(e["host"] == endpoint_host and e["current_state"] == "active" for e in eps):
            break
        time.sleep(1)

    # Build DSN (borrow credentials from the parent DSN)
    parent_dsn = os.environ["DATABASE_URL_DIRECT"]
    # crude host swap — parent host → new endpoint host
    from urllib.parse import urlparse, urlunparse

    p = urlparse(parent_dsn)
    new_netloc = p.netloc.split("@")[0] + "@" + endpoint_host
    dsn = urlunparse(p._replace(netloc=new_netloc))

    try:
        yield dsn
    finally:
        httpx.delete(
            f"{NEON_API}/projects/{project_id}/branches/{branch_id}",
            headers=headers,
            timeout=30,
        )
```

- [ ] **Step 4: Rewrite conftest.py**

Replace `backend/tests/conftest.py` with:

```python
"""Global pytest fixtures — DB session (per-test), HTTP client.

Strategy:
- Session-scoped Neon branch (or fallback to DATABASE_URL_DIRECT)
- Session-scoped engine pointed at the branch
- Schema built once via `alembic upgrade head` against that engine
- Per-test DB session wrapped in a nested transaction that rolls back
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from tests.neon_branch import neon_branch_dsn

if TYPE_CHECKING:
    from collections.abc import Iterator


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def _branch_dsn() -> Iterator[str]:
    with neon_branch_dsn() as dsn:
        yield dsn


@pytest.fixture(scope="session")
def test_engine(_branch_dsn: str) -> Engine:  # noqa: PT019
    # Point app config at the branch for this test session
    os.environ["DATABASE_URL"] = _branch_dsn
    os.environ["DATABASE_URL_DIRECT"] = _branch_dsn
    # Reset cached settings so the env change takes effect
    from app.config import get_settings

    get_settings.cache_clear()

    engine = create_engine(_branch_dsn, pool_pre_ping=True, future=True)

    # Apply migrations
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=PROJECT_ROOT / "backend",
        check=True,
        env={**os.environ, "DATABASE_URL_DIRECT": _branch_dsn},
    )

    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine: Engine) -> Iterator[Session]:
    """Per-test session with transaction rollback.

    Each test sees a clean DB because we roll back at teardown.
    The bootstrap seed (0002) data IS present across tests because
    migrations run once at session scope.
    """
    connection = test_engine.connect()
    transaction = connection.begin()
    SessionLocal = sessionmaker(bind=connection, expire_on_commit=False)
    session = SessionLocal()

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    """TestClient that uses the per-test DB session via dependency override."""
    from app.api.deps import db_session as db_session_dep
    from app.main import app

    def _override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[db_session_dep] = _override
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.pop(db_session_dep, None)
```

> **Caveat:** The `test_engine` fixture imports `app.main`, which runs `validate_config()`. Ensure `.env` has a valid `SESSION_SECRET` (32+ bytes) before running tests. If not, tests will fail at import time with a clear error.

- [ ] **Step 5: Verify the fixtures wire up**

Create a throwaway fixture-check test at `backend/tests/integration/test_fixtures.py`:

```python
"""Sanity check — fixtures resolve and yield usable objects."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session


def test_db_session_executes_queries(db_session: Session) -> None:
    result = db_session.execute(text("SELECT 1")).scalar_one()
    assert result == 1


def test_client_hits_health(client) -> None:  # noqa: ANN001
    r = client.get("/health")
    assert r.status_code == 200
```

Run: `uv run pytest backend/tests/integration/test_fixtures.py -v`
Expected: 2 passed. (First run will take extra time while the Neon branch is provisioned.)

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml uv.lock backend/tests/conftest.py backend/tests/neon_branch.py backend/tests/integration/test_fixtures.py
git commit -m "test(infra): Neon branch + db_session fixture with rollback isolation"
```

---

### Task 7: `0001_initial.py` migration (up + down)

**Files:**
- Create: `backend/alembic/versions/0001_initial.py`
- Modify: `backend/alembic/env.py` — ensure all models are imported for autogenerate
- Test: `backend/tests/integration/test_migrations.py` (partial — full test in Task 8)

- [ ] **Step 1: Wire model imports into alembic env**

Edit `backend/alembic/env.py` — in the section that sets `target_metadata`, add an import line for the models package so Alembic sees all tables. If `target_metadata` is already set, ensure the import chain reaches `app.db.models`. After the existing imports, add:

```python
# Import all models so Alembic autogenerate sees them
from app.db.models import Base  # noqa: E402
target_metadata = Base.metadata
```

Replace any previous `target_metadata = None` or older wiring.

- [ ] **Step 2: Write a dry-run test that migration file parses**

Append to (or create) `backend/tests/integration/test_migrations.py`:

```python
"""Migration tests — upgrade head / downgrade base / schema correctness."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _alembic(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", "alembic", *args],
        cwd=PROJECT_ROOT / "backend",
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.integration
def test_migration_files_parse() -> None:
    # `alembic heads` must succeed — proves every versions/*.py is importable.
    result = _alembic(["heads"])
    assert result.returncode == 0, result.stderr
    assert "0001" in result.stdout or "initial" in result.stdout
```

- [ ] **Step 3: Run test — expect failure (no migration yet)**

Run: `uv run pytest backend/tests/integration/test_migrations.py::test_migration_files_parse -v`
Expected: FAIL — alembic can't find the revision.

- [ ] **Step 4: Create the migration**

Create `backend/alembic/versions/0001_initial.py`:

```python
"""M1 initial schema — entities, users, fx_rates, audit_log.

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-16
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # entities
    op.create_table(
        "entities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("default_credit_days", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("code", name="uq_entities_code"),
    )

    # users (depends on entities)
    role_enum = sa.Enum(
        "ANALYST", "CFO", "ADMIN", "PENDING", name="role_enum"
    )
    role_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("google_sub", sa.String(64), nullable=True),
        sa.Column("name", sa.String(255), nullable=False, server_default=""),
        sa.Column("role", role_enum, nullable=False, server_default="PENDING"),
        sa.Column(
            "entity_id_scope",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("entities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("google_sub", name="uq_users_google_sub"),
    )

    # fx_rates (depends on users via created_by)
    fx_source_enum = sa.Enum("MANUAL", "API", name="fx_rate_source")
    fx_source_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "fx_rates",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("from_ccy", sa.String(3), nullable=False),
        sa.Column("to_ccy", sa.String(3), nullable=False),
        sa.Column("rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("effective_from", sa.Date, nullable=False),
        sa.Column("effective_to", sa.Date, nullable=True),
        sa.Column("source", fx_source_enum, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "from_ccy", "to_ccy", "effective_from", name="uq_fx_rate_triple"
        ),
    )

    # audit_log (depends on users)
    op.create_table(
        "audit_log",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("before", postgresql.JSONB, nullable=True),
        sa.Column("after", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_audit_log_created_at", "audit_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_created_at", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_table("fx_rates")
    sa.Enum(name="fx_rate_source").drop(op.get_bind(), checkfirst=True)
    op.drop_table("users")
    sa.Enum(name="role_enum").drop(op.get_bind(), checkfirst=True)
    op.drop_table("entities")
```

- [ ] **Step 5: Parse check passes**

Run: `uv run pytest backend/tests/integration/test_migrations.py::test_migration_files_parse -v`
Expected: 1 passed.

- [ ] **Step 6: Apply the migration to your local Neon branch**

Run: `cd backend && uv run alembic upgrade head`
Expected: `Running upgrade  -> 0001_initial, M1 initial schema...` — success, no errors.

- [ ] **Step 7: Verify schema with psql**

Run: `uv run python -c "from sqlalchemy import create_engine, inspect; from app.config import get_settings; e = create_engine(get_settings().database_url_direct); print(sorted(inspect(e).get_table_names()))"`
Expected: `['alembic_version', 'audit_log', 'entities', 'fx_rates', 'users']`

- [ ] **Step 8: Downgrade and confirm clean**

Run: `cd backend && uv run alembic downgrade base`
Expected: all 4 tables dropped. Re-run the inspect command — expect only `['alembic_version']` (or empty).

- [ ] **Step 9: Re-upgrade**

Run: `cd backend && uv run alembic upgrade head`
Expected: success.

- [ ] **Step 10: Commit**

```bash
git add backend/alembic/versions/0001_initial.py backend/alembic/env.py backend/tests/integration/test_migrations.py
git commit -m "feat(migrations): 0001 initial schema (entities, users, fx_rates, audit_log)"
```

---

### Task 8: `0002_seed_bootstrap_admin.py` migration

**Files:**
- Create: `backend/alembic/versions/0002_seed_bootstrap_admin.py`
- Modify: `backend/tests/integration/test_migrations.py`

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/integration/test_migrations.py`:

```python
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Entity, User
from app.core.rbac import Role


@pytest.mark.integration
def test_bootstrap_seed_creates_entities_and_admin() -> None:
    # Assumes `alembic upgrade head` has been run (fixture does this).
    engine = create_engine(get_settings().database_url_direct)
    with Session(engine) as s:
        codes = {e.code for e in s.scalars(select(Entity)).all()}
        assert {"EMB_IN", "MANTARAV_UAE"}.issubset(codes)

        admin = s.scalar(
            select(User).where(User.email == "tejaswa.sharma@emb.global")
        )
        assert admin is not None
        assert admin.role == Role.ADMIN
        assert admin.is_active is True
```

- [ ] **Step 2: Run test — expect failure (no seed yet)**

Run: `uv run pytest backend/tests/integration/test_migrations.py::test_bootstrap_seed_creates_entities_and_admin -v`
Expected: FAIL — no admin row, no entities.

- [ ] **Step 3: Create the seed migration**

Create `backend/alembic/versions/0002_seed_bootstrap_admin.py`:

```python
"""Seed bootstrap: 2 entities (EMB_IN, MANTARAV_UAE) + Tejaswa as ADMIN.

Revision ID: 0002_seed_bootstrap_admin
Revises: 0001_initial
Create Date: 2026-04-16
"""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "0002_seed_bootstrap_admin"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


BOOTSTRAP_ADMIN_EMAIL = "tejaswa.sharma@emb.global"
BOOTSTRAP_ADMIN_NAME = "Tejaswa Sharma"


def upgrade() -> None:
    conn = op.get_bind()

    # Entities
    emb_in_id = str(uuid.uuid4())
    mantarav_id = str(uuid.uuid4())
    conn.execute(
        sa.text(
            """
            INSERT INTO entities (id, code, name, country, base_currency)
            VALUES
              (:eid, 'EMB_IN', 'EMB Global India', 'IN', 'INR'),
              (:mid, 'MANTARAV_UAE', 'MANTARAV Digital Information Technology Consultancy',
               'AE', 'AED')
            """
        ),
        {"eid": emb_in_id, "mid": mantarav_id},
    )

    # Bootstrap admin (PENDING by default → override to ADMIN here)
    admin_id = str(uuid.uuid4())
    conn.execute(
        sa.text(
            """
            INSERT INTO users (id, email, name, role, is_active)
            VALUES (:uid, :email, :name, 'ADMIN', TRUE)
            """
        ),
        {
            "uid": admin_id,
            "email": BOOTSTRAP_ADMIN_EMAIL,
            "name": BOOTSTRAP_ADMIN_NAME,
        },
    )

    # Audit the seed
    conn.execute(
        sa.text(
            """
            INSERT INTO audit_log
                (id, actor_user_id, action, entity_type, entity_id, after)
            VALUES
                (:aid, NULL, 'bootstrap_admin_seeded', 'user', :uid, :after)
            """
        ),
        {
            "aid": str(uuid.uuid4()),
            "uid": admin_id,
            "after": json.dumps(
                {
                    "email": BOOTSTRAP_ADMIN_EMAIL,
                    "role": "ADMIN",
                    "is_active": True,
                }
            ),
        },
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM audit_log WHERE action = 'bootstrap_admin_seeded'"
        )
    )
    conn.execute(
        sa.text("DELETE FROM users WHERE email = :email"),
        {"email": BOOTSTRAP_ADMIN_EMAIL},
    )
    conn.execute(
        sa.text(
            "DELETE FROM entities WHERE code IN ('EMB_IN', 'MANTARAV_UAE')"
        )
    )
```

- [ ] **Step 4: Apply**

Run: `cd backend && uv run alembic upgrade head`
Expected: `Running upgrade 0001_initial -> 0002_seed_bootstrap_admin`.

- [ ] **Step 5: Run test**

Run: `uv run pytest backend/tests/integration/test_migrations.py -v`
Expected: all tests pass.

- [ ] **Step 6: Test downgrade**

Run: `cd backend && uv run alembic downgrade 0001_initial`
Expected: seed rows removed.

Run: `uv run python -c "from sqlalchemy import create_engine, select; from sqlalchemy.orm import Session; from app.config import get_settings; from app.db.models import User; e = create_engine(get_settings().database_url_direct); s = Session(e); print(s.scalars(select(User)).all())"`
Expected: `[]`.

- [ ] **Step 7: Re-upgrade**

Run: `cd backend && uv run alembic upgrade head`
Expected: success.

- [ ] **Step 8: Commit**

```bash
git add backend/alembic/versions/0002_seed_bootstrap_admin.py backend/tests/integration/test_migrations.py
git commit -m "feat(migrations): 0002 seed bootstrap entities + ADMIN"
```

---

### Task 9: `/health` router with DB ping

**Files:**
- Create: `backend/src/app/api/routers/__init__.py` (empty)
- Create: `backend/src/app/api/routers/health.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/integration/test_health.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_health.py`:

```python
"""/health — liveness + DB reachability."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health_returns_ok_when_db_up(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "up"


def test_health_returns_503_when_db_down(client: TestClient) -> None:
    with patch("app.api.routers.health._db_ping", side_effect=RuntimeError("down")):
        r = client.get("/health")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert body["db"] == "down"
```

- [ ] **Step 2: Run test — expect failure**

Run: `uv run pytest backend/tests/integration/test_health.py -v`
Expected: FAIL — `body["db"]` KeyError (current `/health` in `main.py` doesn't include it).

- [ ] **Step 3: Create the router**

Create `backend/src/app/api/routers/__init__.py`:

```python
"""API routers — one module per domain."""
```

Create `backend/src/app/api/routers/health.py`:

```python
"""/health — liveness probe used by Railway + monitoring."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import db_session
from app.config import get_settings

router = APIRouter(tags=["meta"])


def _db_ping(session: Session) -> None:
    """Issue a trivial query — raises on any DB problem."""
    session.execute(text("SELECT 1")).scalar_one()


@router.get("/health")
def health(session: Session = Depends(db_session)) -> JSONResponse:
    settings = get_settings()
    try:
        _db_ping(session)
    except Exception:  # noqa: BLE001 — we want any DB error to return 503
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "down", "env": settings.app_env},
        )
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "db": "up", "env": settings.app_env},
    )
```

- [ ] **Step 4: Replace the inline /health in main.py with the router**

Edit `backend/src/app/main.py`:

```python
"""FastAPI entrypoint. Routers are added per milestone."""

from __future__ import annotations

from fastapi import FastAPI

from app.api.routers import health as health_router
from app.config import get_settings
from app.core.logging import configure_logging
from app.db import events as db_events

configure_logging()
db_events.register_events()  # fx_rates immutability hook

settings = get_settings()

app = FastAPI(
    title="Receivables Ageing Dashboard",
    version="0.1.0",
    description=(
        "Internal EMB Global AR ageing platform (India/Tally + UAE/Xero). "
        "Scaffold only — routes added per milestone."
    ),
)

app.include_router(health_router.router)
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest backend/tests/integration/test_health.py -v`
Expected: 2 passed.

- [ ] **Step 6: Smoke-test locally**

Run (in one terminal): `cd backend && uv run uvicorn app.main:app --port 8000`
Run (in another): `curl -s http://localhost:8000/health | jq`
Expected: `{"status": "ok", "db": "up", "env": "development"}`.

Kill uvicorn (Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/api/routers/__init__.py backend/src/app/api/routers/health.py backend/src/app/main.py backend/tests/integration/test_health.py
git commit -m "feat(health): /health with DB ping, 503 on degradation"
```

---

### Task 10: Dockerfile + railway.toml + smoke script

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `railway.toml`
- Create: `scripts/smoke_prod.sh`

- [ ] **Step 1: Create the Dockerfile**

Create `Dockerfile`:

```dockerfile
# Multi-stage: builder installs deps, runtime is minimal.
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy

# Install uv
RUN pip install --no-cache-dir uv==0.11.7

WORKDIR /app

# Copy dep manifests first for cache friendliness
COPY pyproject.toml uv.lock ./

# Sync deps (no dev) into a venv that we'll copy to the runtime stage
RUN uv sync --frozen --no-dev --no-install-project

# Now copy the actual source
COPY backend/src ./backend/src
COPY backend/alembic ./backend/alembic
COPY backend/alembic.ini ./backend/alembic.ini

# Install the project itself
RUN uv sync --frozen --no-dev

# --- Runtime stage -------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/backend /app/backend
COPY --from=builder /app/pyproject.toml /app/pyproject.toml

# Railway injects PORT — default to 8000 for local `docker run`
ENV PORT=8000
EXPOSE 8000

# Working dir must contain `backend/src/app` on PYTHONPATH.
ENV PYTHONPATH=/app/backend/src

# Use shell form so $PORT is expanded at runtime
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
```

- [ ] **Step 2: Create .dockerignore**

Create `.dockerignore`:

```
.git
.venv
__pycache__
*.pyc
*.pyo
.pytest_cache
.ruff_cache
.mypy_cache
.DS_Store
.env
.env.*
frontend
docs
node_modules
backend/tests
backend/tests/fixtures/sample_files
coverage
*.tsbuildinfo
```

- [ ] **Step 3: Create railway.toml**

Create `railway.toml`:

```toml
# Railway deploy config.
# Build via Docker; healthcheck /health; restart on failure.

[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
numReplicas = 1
```

- [ ] **Step 4: Create smoke script**

Create `scripts/smoke_prod.sh`:

```bash
#!/usr/bin/env bash
# Post-deploy smoke test — curl /health and assert db:up.
set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "usage: $0 <base-url>" >&2
  exit 2
fi

response=$(curl -sS -w "\n%{http_code}" "${URL%/}/health")
body=$(echo "$response" | sed '$d')
code=$(echo "$response" | tail -n1)

if [[ "$code" != "200" ]]; then
  echo "SMOKE FAIL — /health returned HTTP $code" >&2
  echo "$body" >&2
  exit 1
fi

if ! echo "$body" | grep -q '"db":"up"'; then
  echo "SMOKE FAIL — /health did not report db:up" >&2
  echo "$body" >&2
  exit 1
fi

echo "SMOKE OK — $URL/health → 200 db:up"
```

- [ ] **Step 5: Make smoke script executable**

Run: `chmod +x scripts/smoke_prod.sh`

- [ ] **Step 6: Build and run locally to verify**

Run: `docker build -t receivables-ageing:local .`
Expected: build succeeds.

Run: `docker run --rm -p 8000:8000 --env-file .env receivables-ageing:local`
Expected: uvicorn starts, binds to 0.0.0.0:8000.

In another terminal: `./scripts/smoke_prod.sh http://localhost:8000`
Expected: `SMOKE OK — http://localhost:8000/health → 200 db:up`.

Kill the container.

> **If Docker isn't installed locally**, skip steps 6. The Dockerfile will be validated on Railway build.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore railway.toml scripts/smoke_prod.sh
git commit -m "chore(deploy): Dockerfile + railway.toml + smoke script"
```

---

### Task 11: Deploy `/health` to Railway + run smoke

**Files:** none changed in-repo. Configure Railway service.

- [ ] **Step 1: Create Railway project (first time only)**

If you haven't yet:
```bash
# Install CLI if needed
npm i -g @railway/cli

railway login
cd /Users/teja/Documents/Claude/Projects/receivables_ageing_dashboard
railway init  # choose "Empty Project", name: receivables-ageing
```

- [ ] **Step 2: Set environment variables on Railway**

Use Railway's web UI or CLI. Required for `/health`:

```
APP_ENV=production
APP_BASE_URL=https://<railway-domain>
DATABASE_URL=postgresql+psycopg://neondb_owner:...@ep-shiny-snow-am6fwdaq-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require
DATABASE_URL_DIRECT=postgresql+psycopg://neondb_owner:...@ep-shiny-snow-am6fwdaq.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require
SESSION_SECRET=<generate 32+ bytes, e.g. `python -c "import secrets; print(secrets.token_urlsafe(48))"`>
SESSION_COOKIE_SECURE=true
```

Use the same Neon values you have in local `.env` for now (M1; we'll split dev/prod DBs in M2 if needed).

- [ ] **Step 3: Link and deploy**

Run: `railway link`  (select the project created above)
Run: `railway up`
Expected: Docker build runs, image deploys, Railway assigns a URL. Note the URL (we'll call it `$RAILWAY_URL`).

- [ ] **Step 4: Apply migrations against prod Neon**

Migrations are NOT auto-run on boot. Run manually once:

```bash
cd backend
DATABASE_URL_DIRECT="<prod direct DSN>" uv run alembic upgrade head
```

Expected: `0001_initial` and `0002_seed_bootstrap_admin` both applied.

- [ ] **Step 5: Run smoke against Railway**

Run: `./scripts/smoke_prod.sh $RAILWAY_URL`
Expected: `SMOKE OK — <url>/health → 200 db:up`.

- [ ] **Step 6: Hit in a browser**

Open `$RAILWAY_URL/health` in a browser. Confirm JSON renders.

- [ ] **Step 7: Document the Railway URL in README**

Edit `README.md`, under the M1 section, add:

```markdown
### Deployed (staging/prod)
- App: <RAILWAY_URL>
- /health: <RAILWAY_URL>/health
```

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs(deploy): record Railway URL + confirm M1 day-1 skeleton live"
```

---

## Day 2 — SSO

### Task 12: Session middleware wiring + startup config guard

**Files:**
- Create: `backend/src/app/core/startup.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/unit/test_startup.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_startup.py`:

```python
"""Startup config validation — fail fast on missing required config."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.core.startup import ConfigError, validate_config


def _base_settings(**kwargs: object) -> Settings:
    defaults = {
        "app_env": "production",
        "database_url": "postgresql://u:p@h/d",
        "database_url_direct": "postgresql://u:p@h/d",
        "session_secret": "x" * 32,
        "auth_provider": "google",
        "google_oauth_client_id": "cid",
        "google_oauth_client_secret": "csec",
    }
    defaults.update(kwargs)
    return Settings(**defaults)  # type: ignore[arg-type]


def test_validate_config_passes_full_prod() -> None:
    validate_config(_base_settings())


def test_validate_config_raises_on_empty_database_url() -> None:
    with pytest.raises(ConfigError, match="DATABASE_URL"):
        validate_config(_base_settings(database_url=""))


def test_validate_config_raises_on_empty_database_url_direct() -> None:
    with pytest.raises(ConfigError, match="DATABASE_URL_DIRECT"):
        validate_config(_base_settings(database_url_direct=""))


def test_validate_config_raises_on_short_session_secret() -> None:
    with pytest.raises(ConfigError, match="SESSION_SECRET"):
        validate_config(_base_settings(session_secret="short"))


def test_validate_config_raises_on_prod_stub_auth() -> None:
    with pytest.raises(ConfigError, match="auth_provider=stub"):
        validate_config(_base_settings(auth_provider="stub"))


def test_validate_config_raises_on_prod_missing_google_client_id() -> None:
    with pytest.raises(ConfigError, match="GOOGLE_OAUTH_CLIENT_ID"):
        validate_config(_base_settings(google_oauth_client_id=""))


def test_validate_config_allows_stub_in_dev() -> None:
    validate_config(_base_settings(app_env="development", auth_provider="stub"))
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_startup.py -v`
Expected: FAIL `ModuleNotFoundError`.

- [ ] **Step 3: Create the startup module**

Create `backend/src/app/core/startup.py`:

```python
"""Fail-fast config validation. Called once in app/main.py on boot."""

from __future__ import annotations

from app.config import Settings


class ConfigError(RuntimeError):
    """Raised on invalid or missing required config at app boot."""


def validate_config(settings: Settings) -> None:
    if not settings.database_url:
        raise ConfigError("DATABASE_URL is required")
    if not settings.database_url_direct:
        raise ConfigError("DATABASE_URL_DIRECT is required (for Alembic)")
    if len(settings.session_secret) < 32:
        raise ConfigError("SESSION_SECRET must be at least 32 bytes")

    if settings.is_production:
        if settings.auth_provider == "stub":
            raise ConfigError(
                "auth_provider=stub is forbidden in production"
            )
        if not settings.google_oauth_client_id:
            raise ConfigError("GOOGLE_OAUTH_CLIENT_ID is required in production")
        if not settings.google_oauth_client_secret:
            raise ConfigError(
                "GOOGLE_OAUTH_CLIENT_SECRET is required in production"
            )
```

- [ ] **Step 4: Wire session middleware + startup check into main.py**

Edit `backend/src/app/main.py`:

```python
"""FastAPI entrypoint. Routers are added per milestone."""

from __future__ import annotations

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.api.routers import health as health_router
from app.config import get_settings
from app.core.logging import configure_logging
from app.core.startup import validate_config
from app.db import events as db_events

configure_logging()
db_events.register_events()  # fx_rates immutability hook

settings = get_settings()
validate_config(settings)  # fail fast on bad config

app = FastAPI(
    title="Receivables Ageing Dashboard",
    version="0.1.0",
)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret,
    max_age=settings.session_max_age_seconds,
    same_site="lax",
    https_only=settings.session_cookie_secure,
)

app.include_router(health_router.router)
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest backend/tests/unit/test_startup.py backend/tests/integration/test_health.py -v`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/core/startup.py backend/src/app/main.py backend/tests/unit/test_startup.py
git commit -m "feat(startup): SessionMiddleware + fail-fast config validation"
```

---

### Task 13: `AuthProvider` protocol + `StubAuthProvider`

**Files:**
- Create: `backend/src/app/core/auth.py` (partial — stub only, Google in Task 14)
- Test: `backend/tests/unit/test_auth_provider.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_auth_provider.py`:

```python
"""Auth provider — Stub behavior + factory selection."""

from __future__ import annotations

import pytest
from fastapi import Request
from starlette.datastructures import Headers

from app.core.auth import (
    GoogleUserInfo,
    StubAuthProvider,
)


def _req_with_headers(headers: dict[str, str]) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_stub_provider_returns_user_from_header() -> None:
    provider = StubAuthProvider()
    req = _req_with_headers({"X-Stub-Email": "user@emb.global"})
    info = await provider.callback(req)
    assert isinstance(info, GoogleUserInfo)
    assert info.email == "user@emb.global"
    assert info.sub.startswith("stub|")


@pytest.mark.asyncio
async def test_stub_provider_raises_when_header_missing() -> None:
    provider = StubAuthProvider()
    req = _req_with_headers({})
    with pytest.raises(ValueError, match="X-Stub-Email"):
        await provider.callback(req)
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_auth_provider.py -v`
Expected: FAIL `ModuleNotFoundError`.

- [ ] **Step 3: Create auth.py with the protocol + stub**

Create `backend/src/app/core/auth.py`:

```python
"""Pluggable auth providers.

- GoogleAuthProvider: authlib-backed real OAuth2 (see Task 14)
- StubAuthProvider: reads X-Stub-Email header; local dev + tests only

Never ship `stub` to production — startup.py raises if app_env=production
and auth_provider=stub.
"""

from __future__ import annotations

import hashlib
from typing import Protocol

from fastapi import Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, EmailStr


class GoogleUserInfo(BaseModel):
    email: EmailStr
    sub: str  # stable Google account id (or stub id)
    name: str = ""


class AuthProvider(Protocol):
    async def login_redirect(self, request: Request) -> Response: ...
    async def callback(self, request: Request) -> GoogleUserInfo: ...


class StubAuthProvider:
    """Reads email from X-Stub-Email header. Tests only."""

    async def login_redirect(self, request: Request) -> Response:  # noqa: ARG002
        # Stub doesn't actually redirect anywhere — just bounces to callback
        # which will read the header and proceed.
        return RedirectResponse(url="/auth/google/callback", status_code=302)

    async def callback(self, request: Request) -> GoogleUserInfo:
        email = request.headers.get("X-Stub-Email")
        if not email:
            raise ValueError(
                "StubAuthProvider requires X-Stub-Email header; missing"
            )
        # Derive a stable 'sub' from the email so re-login is idempotent.
        stub_sub = "stub|" + hashlib.sha256(email.lower().encode()).hexdigest()[:16]
        return GoogleUserInfo(email=email.lower(), sub=stub_sub, name=email.split("@")[0])
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_auth_provider.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/core/auth.py backend/tests/unit/test_auth_provider.py
git commit -m "feat(auth): AuthProvider protocol + StubAuthProvider"
```

---

### Task 14: `GoogleAuthProvider` + factory

**Files:**
- Modify: `backend/src/app/core/auth.py`
- Test: `backend/tests/unit/test_auth_provider.py`

- [ ] **Step 1: Add factory tests**

Append to `backend/tests/unit/test_auth_provider.py`:

```python
from app.core.auth import (
    GoogleAuthProvider,
    get_auth_provider,
)
from app.config import Settings


def _settings_with(**kw: object) -> Settings:
    defaults = {
        "app_env": "development",
        "auth_provider": "stub",
        "database_url": "postgresql://u:p@h/d",
        "database_url_direct": "postgresql://u:p@h/d",
        "session_secret": "x" * 32,
        "google_oauth_client_id": "cid",
        "google_oauth_client_secret": "csec",
    }
    defaults.update(kw)
    return Settings(**defaults)  # type: ignore[arg-type]


def test_factory_returns_stub_by_default() -> None:
    provider = get_auth_provider(_settings_with())
    assert isinstance(provider, StubAuthProvider)


def test_factory_returns_google_when_selected() -> None:
    provider = get_auth_provider(_settings_with(auth_provider="google"))
    assert isinstance(provider, GoogleAuthProvider)


def test_factory_raises_on_prod_stub() -> None:
    with pytest.raises(RuntimeError, match="stub.*production"):
        get_auth_provider(
            _settings_with(app_env="production", auth_provider="stub")
        )
```

- [ ] **Step 2: Run tests — expect import failures**

Run: `uv run pytest backend/tests/unit/test_auth_provider.py -v`
Expected: FAIL on `GoogleAuthProvider` + `get_auth_provider` imports.

- [ ] **Step 3: Add Google provider + factory**

Edit `backend/src/app/core/auth.py` — append below `StubAuthProvider`:

```python
from authlib.integrations.starlette_client import OAuth  # noqa: E402

from app.config import Settings, get_settings  # noqa: E402


def _build_oauth() -> OAuth:
    settings = get_settings()
    oauth = OAuth()
    oauth.register(
        name="google",
        client_id=settings.google_oauth_client_id,
        client_secret=settings.google_oauth_client_secret,
        server_metadata_url=(
            "https://accounts.google.com/.well-known/openid-configuration"
        ),
        client_kwargs={"scope": "openid email profile"},
    )
    return oauth


class GoogleAuthProvider:
    """authlib-backed real Google OAuth2 flow."""

    def __init__(self) -> None:
        self._oauth = _build_oauth()

    async def login_redirect(self, request: Request) -> Response:
        settings = get_settings()
        return await self._oauth.google.authorize_redirect(
            request, settings.google_oauth_redirect_uri
        )

    async def callback(self, request: Request) -> GoogleUserInfo:
        token = await self._oauth.google.authorize_access_token(request)
        userinfo = token.get("userinfo") or await self._oauth.google.parse_id_token(
            request, token
        )
        return GoogleUserInfo(
            email=userinfo["email"].lower(),
            sub=str(userinfo["sub"]),
            name=userinfo.get("name", ""),
        )


def get_auth_provider(settings: Settings | None = None) -> AuthProvider:
    s = settings or get_settings()
    if s.is_production and s.auth_provider == "stub":
        raise RuntimeError(
            "auth_provider=stub is forbidden in production (startup guard)"
        )
    if s.auth_provider == "google":
        return GoogleAuthProvider()
    return StubAuthProvider()
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_auth_provider.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/core/auth.py backend/tests/unit/test_auth_provider.py
git commit -m "feat(auth): GoogleAuthProvider (authlib) + provider factory"
```

---

### Task 15: pydantic schemas

**Files:**
- Create: `backend/src/app/schemas/__init__.py`
- Create: `backend/src/app/schemas/user.py`
- Create: `backend/src/app/schemas/entity.py`
- Test: `backend/tests/unit/test_schemas.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_schemas.py`:

```python
"""pydantic schemas — request/response payloads for M1 endpoints."""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.core.rbac import Role
from app.schemas.user import MeOut, UserOut, UserUpdateIn


def test_user_out_accepts_minimal() -> None:
    uo = UserOut(
        id=uuid.uuid4(),
        email="a@emb.global",
        name="A",
        role=Role.ANALYST,
        entity_id_scope=uuid.uuid4(),
        is_active=True,
    )
    assert uo.role == Role.ANALYST


def test_me_out_includes_role() -> None:
    mo = MeOut(
        id=uuid.uuid4(),
        email="a@emb.global",
        name="A",
        role=Role.CFO,
        entity_id_scope=None,
        is_active=True,
    )
    assert mo.role == Role.CFO


def test_user_update_in_accepts_partial() -> None:
    u = UserUpdateIn(role=Role.ADMIN)
    assert u.role == Role.ADMIN
    assert u.entity_id_scope is None
    assert u.is_active is None


def test_user_update_in_allows_null_entity_scope() -> None:
    # Enforced at service layer, not schema — ADMIN/CFO legitimately have NULL.
    u = UserUpdateIn(role=Role.ANALYST, entity_id_scope=None)
    assert u.entity_id_scope is None


def test_user_update_in_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        UserUpdateIn(role=Role.ADMIN, foo="bar")  # type: ignore[call-arg]
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/unit/test_schemas.py -v`
Expected: FAIL.

- [ ] **Step 3: Create schemas**

Create `backend/src/app/schemas/__init__.py`:

```python
"""Request/response pydantic schemas — one module per resource."""
```

Create `backend/src/app/schemas/entity.py`:

```python
"""Entity response schema."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict


class EntityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    country: str
    base_currency: str
    default_credit_days: int | None
```

Create `backend/src/app/schemas/user.py`:

```python
"""User request/response schemas."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr

from app.core.rbac import Role


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: uuid.UUID
    email: EmailStr
    name: str
    role: Role
    entity_id_scope: uuid.UUID | None
    is_active: bool


class MeOut(UserOut):
    """Same shape as UserOut — kept distinct for future divergence."""


class UserUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Role | None = None
    entity_id_scope: uuid.UUID | None = None
    is_active: bool | None = None
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_schemas.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/schemas/ backend/tests/unit/test_schemas.py
git commit -m "feat(schemas): UserOut/MeOut/UserUpdateIn/EntityOut"
```

---

### Task 16: `get_current_user` dependency + 12h idle enforcement

**Files:**
- Modify: `backend/src/app/api/deps.py`
- Test: `backend/tests/unit/test_session_idle.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_session_idle.py`:

```python
"""get_current_user — 401 on missing/expired/inactive user + sliding window."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException, Request

from app.api.deps import get_current_user
from app.core.rbac import Role


def _req(session: dict) -> Request:
    scope = {"type": "http", "headers": [], "session": session}
    return Request(scope)


def test_get_current_user_401_without_user_id() -> None:
    req = _req({})
    with pytest.raises(HTTPException) as exc:
        get_current_user(request=req, db=MagicMock())
    assert exc.value.status_code == 401


def test_get_current_user_401_when_idle_beyond_12h() -> None:
    stale = (datetime.now(UTC) - timedelta(hours=12, minutes=1)).isoformat()
    req = _req({"user_id": str(uuid.uuid4()), "last_seen": stale})
    with pytest.raises(HTTPException) as exc:
        get_current_user(request=req, db=MagicMock())
    assert exc.value.status_code == 401


def test_get_current_user_slides_last_seen() -> None:
    uid = uuid.uuid4()
    fresh = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    session = {"user_id": str(uid), "last_seen": fresh}
    req = _req(session)

    # Mock DB returning an active user row
    user = MagicMock()
    user.id = uid
    user.is_active = True
    user.role = Role.ANALYST
    db = MagicMock()
    db.get.return_value = user

    returned = get_current_user(request=req, db=db)
    assert returned is user
    # last_seen refreshed within last second
    new_last_seen = datetime.fromisoformat(session["last_seen"])
    delta = datetime.now(UTC) - new_last_seen
    assert delta.total_seconds() < 1


def test_get_current_user_401_when_user_inactive() -> None:
    uid = uuid.uuid4()
    fresh = datetime.now(UTC).isoformat()
    req = _req({"user_id": str(uid), "last_seen": fresh})

    user = MagicMock()
    user.is_active = False
    db = MagicMock()
    db.get.return_value = user

    with pytest.raises(HTTPException) as exc:
        get_current_user(request=req, db=db)
    assert exc.value.status_code == 401
```

- [ ] **Step 2: Run test — expect failure**

Run: `uv run pytest backend/tests/unit/test_session_idle.py -v`
Expected: FAIL — `get_current_user` not defined.

- [ ] **Step 3: Implement get_current_user**

Edit `backend/src/app/api/deps.py` — replace the whole file with:

```python
"""Shared FastAPI dependencies — DB session, current user, RBAC gates."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models.user import User
from app.db.session import get_db

if TYPE_CHECKING:
    from collections.abc import Iterator


def db_session() -> Iterator[Session]:
    """Re-export of `get_db` at the API boundary."""
    yield from get_db()


def get_current_user(
    request: Request,
    db: Session = Depends(db_session),
) -> User:
    settings = get_settings()

    session = request.session
    user_id_raw = session.get("user_id")
    last_seen_raw = session.get("last_seen")
    if not user_id_raw or not last_seen_raw:
        raise HTTPException(status_code=401, detail="not_authenticated")

    try:
        last_seen = datetime.fromisoformat(last_seen_raw)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="bad_session") from exc

    idle_limit = timedelta(seconds=settings.session_max_age_seconds)
    if datetime.now(UTC) - last_seen > idle_limit:
        raise HTTPException(status_code=401, detail="session_idle_expired")

    try:
        user_id = uuid.UUID(user_id_raw)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="bad_session") from exc

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="inactive_or_missing")

    # Slide the idle window
    session["last_seen"] = datetime.now(UTC).isoformat()
    return user


__all__ = ["db_session", "get_current_user", "Depends"]
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_session_idle.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/api/deps.py backend/tests/unit/test_session_idle.py
git commit -m "feat(auth): get_current_user with 12h idle + sliding window"
```

---

### Task 17: `/auth/google/login` + `/auth/logout` + `/auth/me`

**Files:**
- Create: `backend/src/app/api/routers/auth.py` (partial — login/logout/me now; callback in Task 18)
- Modify: `backend/src/app/main.py` — mount auth router
- Create: `backend/tests/integration/test_auth_flow.py` (partial)

- [ ] **Step 1: Write /auth/me + /auth/logout tests**

Create `backend/tests/integration/test_auth_flow.py` (uses the `client` fixture from Task 6B):

```python
"""Auth flow — stub provider, full callback → me → logout cycle."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_me_unauthenticated_returns_401(client: TestClient) -> None:
    r = client.get("/auth/me")
    assert r.status_code == 401


def test_logout_clears_session(client: TestClient) -> None:
    r = client.post("/auth/logout")
    assert r.status_code == 200
    # Subsequent /auth/me is 401
    r2 = client.get("/auth/me")
    assert r2.status_code == 401
```

- [ ] **Step 2: Run tests — expect 404 (no routes yet)**

Run: `uv run pytest backend/tests/integration/test_auth_flow.py -v`
Expected: FAIL — 404 on `/auth/me`.

- [ ] **Step 3: Create the auth router with login/logout/me**

Create `backend/src/app/api/routers/auth.py`:

```python
"""Auth endpoints — Google SSO login/callback, logout, /me."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse, Response

from app.api.deps import get_current_user
from app.core.auth import get_auth_provider
from app.db.models.user import User
from app.schemas.user import MeOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/google/login")
async def google_login(request: Request) -> Response:
    provider = get_auth_provider()
    return await provider.login_redirect(request)


@router.post("/logout")
def logout(request: Request) -> JSONResponse:
    request.session.clear()
    return JSONResponse(status_code=status.HTTP_200_OK, content={"status": "logged_out"})


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)) -> MeOut:
    return MeOut.model_validate(user)
```

- [ ] **Step 4: Wire router into main.py**

Edit `backend/src/app/main.py` — add import and include_router:

```python
from app.api.routers import auth as auth_router
...
app.include_router(auth_router.router)
```

(keep the existing `app.include_router(health_router.router)` as-is.)

- [ ] **Step 5: Run tests**

Run: `uv run pytest backend/tests/integration/test_auth_flow.py -v`
Expected: 2 passed (just the /me unauth + logout-is-idempotent cases). Callback tests come in Task 18.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/api/routers/auth.py backend/src/app/main.py backend/tests/integration/test_auth_flow.py
git commit -m "feat(auth): /auth/google/login, /auth/logout, /auth/me"
```

---

### Task 18: `/auth/google/callback` (upsert + domain lock + audit_log)

**Files:**
- Modify: `backend/src/app/api/routers/auth.py`
- Test: `backend/tests/integration/test_auth_flow.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/integration/test_auth_flow.py`:

```python
from datetime import UTC, datetime
from sqlalchemy import select

from app.core.rbac import Role
from app.db.models import AuditLog, User


def test_callback_new_user_creates_pending(client: TestClient, db_session) -> None:  # noqa: ANN001
    email = "newperson@emb.global"
    r = client.get("/auth/google/callback", headers={"X-Stub-Email": email})
    assert r.status_code in (200, 302)

    user = db_session.scalar(select(User).where(User.email == email))
    assert user is not None
    assert user.role == Role.PENDING
    assert user.last_login_at is not None

    audit = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.entity_id == user.id)
        .where(AuditLog.action == "user_created")
    )
    assert audit is not None


def test_callback_returning_user_refreshes_last_login(client: TestClient, db_session) -> None:  # noqa: ANN001
    email = "returning@emb.global"
    client.get("/auth/google/callback", headers={"X-Stub-Email": email})
    user_a = db_session.scalar(select(User).where(User.email == email))
    first_login = user_a.last_login_at

    # Sign in again
    client.cookies.clear()
    client.get("/auth/google/callback", headers={"X-Stub-Email": email})
    db_session.expire_all()
    user_b = db_session.scalar(select(User).where(User.email == email))
    assert user_b.last_login_at > first_login
    # Still exactly one user row
    assert db_session.scalar(
        select(User).where(User.email == email).with_only_columns(User.id)
    ) is not None


def test_callback_rejects_non_emb_domain(client: TestClient, db_session) -> None:  # noqa: ANN001
    email = "random@gmail.com"
    r = client.get("/auth/google/callback", headers={"X-Stub-Email": email})
    assert r.status_code == 403
    user = db_session.scalar(select(User).where(User.email == email))
    assert user is None


def test_me_returns_user_after_callback(client: TestClient) -> None:
    client.get("/auth/google/callback", headers={"X-Stub-Email": "me@emb.global"})
    r = client.get("/auth/me")
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "me@emb.global"
    assert body["role"] == "PENDING"
```

- [ ] **Step 2: Run tests — expect failures**

Run: `uv run pytest backend/tests/integration/test_auth_flow.py -v`
Expected: FAIL — callback endpoint missing.

- [ ] **Step 3: Add callback endpoint**

Edit `backend/src/app/api/routers/auth.py` — insert above `/me`:

```python
from datetime import UTC, datetime

from sqlalchemy.orm import Session
from fastapi import HTTPException
from fastapi.responses import RedirectResponse

from app.api.deps import db_session
from app.config import get_settings
from app.core.audit import write_audit_log
from app.core.auth import GoogleUserInfo, get_auth_provider
from app.db.models.user import User
from app.core.rbac import Role


def _upsert_user(
    db: Session, info: GoogleUserInfo, actor_id=None
) -> tuple[User, bool]:
    """Returns (user, created). Creates PENDING on miss, refreshes on hit."""
    user = db.query(User).filter(User.email == info.email).one_or_none()
    created = False
    if user is None:
        user = User(
            email=info.email,
            name=info.name,
            google_sub=info.sub,
            role=Role.PENDING,
            is_active=True,
            last_login_at=datetime.now(UTC),
        )
        db.add(user)
        db.flush()  # populate user.id before audit_log insert
        write_audit_log(
            db,
            actor_user_id=None,
            action="user_created",
            entity_type="user",
            entity_id=user.id,
            before=None,
            after={"email": user.email, "role": user.role.value},
        )
        created = True
    else:
        # Pin google_sub on first real login if it was NULL (fresh bootstrap admin)
        if user.google_sub is None:
            user.google_sub = info.sub
        user.name = info.name or user.name
        user.last_login_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)
    return user, created


@router.get("/google/callback")
async def google_callback(
    request: Request, db: Session = Depends(db_session)
) -> Response:
    settings = get_settings()
    provider = get_auth_provider()
    try:
        info = await provider.callback(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    allowed_domain = settings.google_oauth_allowed_domain.lower()
    if not info.email.lower().endswith("@" + allowed_domain):
        raise HTTPException(
            status_code=403, detail="email_domain_not_allowed"
        )

    user, _created = _upsert_user(db, info)

    request.session["user_id"] = str(user.id)
    request.session["last_seen"] = datetime.now(UTC).isoformat()

    return RedirectResponse(url="/", status_code=302)
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/integration/test_auth_flow.py -v`
Expected: all 6 tests (2 from Task 17 + 4 new) pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/api/routers/auth.py backend/tests/integration/test_auth_flow.py
git commit -m "feat(auth): /auth/google/callback with upsert + domain lock + audit"
```

---

### Task 19: Deploy preview + manual Google SSO smoke

**Files:** none in-repo. Railway preview + Google Cloud Console configuration.

- [ ] **Step 1: Create Google OAuth client in GCP**

In Google Cloud Console (ping IT for access if not already admin on an EMB project):
1. APIs & Services → OAuth consent screen → Internal (Workspace)
2. Scopes: `openid`, `email`, `profile`
3. Credentials → Create OAuth client ID → Web application
4. Authorized redirect URI: `https://<railway-url>/auth/google/callback`
5. Copy `client_id` + `client_secret`

- [ ] **Step 2: Add OAuth vars to Railway**

Set on Railway:
```
AUTH_PROVIDER=google
GOOGLE_OAUTH_CLIENT_ID=<from step 1>
GOOGLE_OAUTH_CLIENT_SECRET=<from step 1>
GOOGLE_OAUTH_ALLOWED_DOMAIN=emb.global
GOOGLE_OAUTH_REDIRECT_URI=https://<railway-url>/auth/google/callback
```

- [ ] **Step 3: Deploy**

Run: `railway up`
Expected: build + deploy succeed.

- [ ] **Step 4: Manual smoke — sign in**

In a browser, open `https://<railway-url>/auth/google/login`.
Expected:
- Redirects to Google consent
- After consent, returns to `/`
- Browser has session cookie set

Then hit `https://<railway-url>/auth/me`.
Expected: 200 with `{id, email, name, role, entity_id_scope, is_active}`.

If signing in as `tejaswa.sharma@emb.global`, `role` should be `ADMIN` (from bootstrap seed). Otherwise, `PENDING`.

- [ ] **Step 5: Manual smoke — domain lock**

Sign out (hit `/auth/logout`). In an incognito window, sign in with a non-emb.global Google account.
Expected: 403 `email_domain_not_allowed`.

- [ ] **Step 6: Run post-deploy smoke script**

Run: `./scripts/smoke_prod.sh https://<railway-url>`
Expected: `SMOKE OK`.

- [ ] **Step 7: Record in README**

Edit `README.md`, under M1 section:

```markdown
- Google SSO wired, domain-locked to @emb.global
- Session cookie, 12h idle
```

Commit: 
```bash
git add README.md
git commit -m "docs(m1): record SSO live on day 2"
```

---

## Day 3 — RBAC + Admin + Wrap

### Task 20: `require_role` RBAC factory

**Files:**
- Modify: `backend/src/app/core/rbac.py`
- Test: `backend/tests/unit/test_rbac.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_rbac.py`:

```python
"""require_role factory — 403 on disallowed role, 403 on PENDING, pass on match."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.core.rbac import Role, require_role


def _user_with(role: Role):  # noqa: ANN202
    u = MagicMock()
    u.role = role
    return u


def test_require_role_admin_allows_admin() -> None:
    dep = require_role(Role.ADMIN)
    assert dep(user=_user_with(Role.ADMIN)) is not None


def test_require_role_admin_rejects_analyst() -> None:
    dep = require_role(Role.ADMIN)
    with pytest.raises(HTTPException) as exc:
        dep(user=_user_with(Role.ANALYST))
    assert exc.value.status_code == 403


def test_require_role_admin_rejects_cfo() -> None:
    dep = require_role(Role.ADMIN)
    with pytest.raises(HTTPException) as exc:
        dep(user=_user_with(Role.CFO))
    assert exc.value.status_code == 403


def test_require_role_always_rejects_pending() -> None:
    dep = require_role(Role.ANALYST, Role.CFO, Role.ADMIN, Role.PENDING)
    # Even if PENDING is explicitly in the set, we reject it — belt + braces.
    with pytest.raises(HTTPException) as exc:
        dep(user=_user_with(Role.PENDING))
    assert exc.value.status_code == 403


def test_require_role_multi_allowed() -> None:
    dep = require_role(Role.ANALYST, Role.CFO)
    assert dep(user=_user_with(Role.ANALYST)) is not None
    assert dep(user=_user_with(Role.CFO)) is not None
    with pytest.raises(HTTPException):
        dep(user=_user_with(Role.ADMIN))
```

- [ ] **Step 2: Run test — expect failure**

Run: `uv run pytest backend/tests/unit/test_rbac.py -v`
Expected: FAIL — `require_role` not defined.

- [ ] **Step 3: Implement require_role**

Edit `backend/src/app/core/rbac.py` — append:

```python
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException

from app.api.deps import get_current_user
from app.db.models.user import User


def require_role(*allowed: Role) -> Callable[..., User]:
    """FastAPI dependency factory.

    Rejects PENDING unconditionally. Rejects any role not in `allowed` with 403.
    """

    def _dep(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role == Role.PENDING or user.role not in allowed:
            raise HTTPException(status_code=403, detail="insufficient_role")
        return user

    return _dep
```

> **Circular-import note:** `rbac.py` now imports from `api.deps`, which imports `User`. Make sure `rbac.py` itself stays free of any `api.*` import at module load time — only inside `require_role`. The import above is at module top because `get_current_user` is only referenced lazily by FastAPI at request time; if you see a circular-import error at boot, move the `from app.api.deps import get_current_user` line *inside* `require_role`.

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/unit/test_rbac.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/core/rbac.py backend/tests/unit/test_rbac.py
git commit -m "feat(rbac): require_role(*allowed) FastAPI dependency"
```

---

### Task 21: `write_audit_log` helper

**Files:**
- Create: `backend/src/app/core/audit.py`
- Test: `backend/tests/integration/test_audit.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/integration/test_audit.py`:

```python
"""write_audit_log helper — inserts a row in the current session, no commit."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.audit import write_audit_log
from app.db.models import AuditLog


def test_write_audit_log_inserts_row(db_session) -> None:  # noqa: ANN001
    target_id = uuid.uuid4()
    write_audit_log(
        db_session,
        actor_user_id=None,
        action="unit_test_action",
        entity_type="widget",
        entity_id=target_id,
        before={"foo": 1},
        after={"foo": 2},
    )
    db_session.commit()

    row = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "unit_test_action")
    )
    assert row is not None
    assert row.entity_id == target_id
    assert row.before == {"foo": 1}
    assert row.after == {"foo": 2}
```

- [ ] **Step 2: Run test — expect import failure**

Run: `uv run pytest backend/tests/integration/test_audit.py -v`
Expected: FAIL.

- [ ] **Step 3: Create the helper**

Create `backend/src/app/core/audit.py`:

```python
"""write_audit_log — call inside your transaction before commit.

Does not commit. Caller is responsible — the write is part of the same
transaction as the mutation it's auditing (spec §9 + CLAUDE.md).
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.db.models.audit_log import AuditLog


def write_audit_log(
    db: Session,
    *,
    actor_user_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: uuid.UUID | None,
    before: dict | None,
    after: dict | None,
) -> AuditLog:
    row = AuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=before,
        after=after,
    )
    db.add(row)
    db.flush()
    return row
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/integration/test_audit.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/core/audit.py backend/tests/integration/test_audit.py
git commit -m "feat(audit): write_audit_log helper (flush, no commit)"
```

---

### Task 22: `GET /admin/users`

**Files:**
- Create: `backend/src/app/api/routers/admin.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/integration/test_admin_users.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/integration/test_admin_users.py`:

```python
"""/admin/users — RBAC gates + listing behavior."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.rbac import Role
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _sign_in(client: TestClient, email: str) -> None:
    client.cookies.clear()
    client.get("/auth/google/callback", headers={"X-Stub-Email": email})


def test_list_users_requires_auth(client: TestClient) -> None:
    r = client.get("/admin/users")
    assert r.status_code == 401


def test_list_users_rejects_analyst(client: TestClient, db_session) -> None:  # noqa: ANN001
    # Create an ANALYST
    from app.db.models.user import User

    u = User(
        email="a@emb.global",
        name="A",
        role=Role.ANALYST,
        is_active=True,
    )
    db_session.add(u)
    db_session.commit()

    _sign_in(client, "a@emb.global")
    r = client.get("/admin/users")
    assert r.status_code == 403


def test_list_users_rejects_pending(client: TestClient) -> None:
    _sign_in(client, "pending@emb.global")  # auto-created as PENDING
    r = client.get("/admin/users")
    assert r.status_code == 403


def test_list_users_admin_sees_all(client: TestClient) -> None:
    # Bootstrap admin from 0002 seed
    _sign_in(client, "tejaswa.sharma@emb.global")
    r = client.get("/admin/users")
    assert r.status_code == 200
    users = r.json()
    assert isinstance(users, list)
    assert any(u["email"] == "tejaswa.sharma@emb.global" for u in users)


def test_list_users_filter_by_pending_status(client: TestClient) -> None:
    _sign_in(client, "x@emb.global")  # creates a PENDING
    _sign_in(client, "tejaswa.sharma@emb.global")
    r = client.get("/admin/users?status=PENDING")
    assert r.status_code == 200
    users = r.json()
    assert all(u["role"] == "PENDING" for u in users)
    assert any(u["email"] == "x@emb.global" for u in users)
```

- [ ] **Step 2: Run tests — expect 404**

Run: `uv run pytest backend/tests/integration/test_admin_users.py -v`
Expected: FAIL — `/admin/users` 404.

- [ ] **Step 3: Create the admin router**

Create `backend/src/app/api/routers/admin.py`:

```python
"""Admin endpoints — user management. ADMIN-only (spec §13)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import db_session
from app.core.rbac import Role, require_role
from app.db.models.user import User
from app.schemas.user import UserOut

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users", response_model=list[UserOut])
def list_users(
    status: Annotated[Role | None, Query(description="Filter by role")] = None,
    _: Annotated[User, Depends(require_role(Role.ADMIN))] = None,  # type: ignore[assignment]
    db: Session = Depends(db_session),
) -> list[UserOut]:
    stmt = select(User)
    if status is not None:
        stmt = stmt.where(User.role == status)
    stmt = stmt.order_by(User.created_at.desc())
    users = db.scalars(stmt).all()
    return [UserOut.model_validate(u) for u in users]
```

- [ ] **Step 4: Mount the router**

Edit `backend/src/app/main.py` — add to imports and include_router:

```python
from app.api.routers import admin as admin_router
...
app.include_router(admin_router.router)
```

- [ ] **Step 5: Run tests**

Run: `uv run pytest backend/tests/integration/test_admin_users.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/api/routers/admin.py backend/src/app/main.py backend/tests/integration/test_admin_users.py
git commit -m "feat(admin): GET /admin/users with ?status filter, ADMIN-only"
```

---

### Task 23: `PATCH /admin/users/{id}` + validations

**Files:**
- Modify: `backend/src/app/api/routers/admin.py`
- Modify: `backend/tests/integration/test_admin_users.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/integration/test_admin_users.py`:

```python
from sqlalchemy import select

from app.db.models import AuditLog, Entity, User


def _admin_client() -> TestClient:
    c = TestClient(app)
    c.get(
        "/auth/google/callback",
        headers={"X-Stub-Email": "tejaswa.sharma@emb.global"},
    )
    return c


def test_patch_requires_admin(client: TestClient) -> None:
    _sign_in(client, "pending@emb.global")
    r = client.patch(
        "/admin/users/00000000-0000-0000-0000-000000000000",
        json={"role": "ANALYST"},
    )
    assert r.status_code == 403


def test_patch_nonexistent_returns_404() -> None:
    c = _admin_client()
    r = c.patch(
        "/admin/users/00000000-0000-0000-0000-000000000000",
        json={"role": "ANALYST"},
    )
    assert r.status_code == 404


def test_patch_promote_pending_to_analyst_writes_audit(db_session) -> None:  # noqa: ANN001
    c = _admin_client()
    # Create a PENDING user
    pending = User(
        email="newbie@emb.global", name="Newbie", role=Role.PENDING, is_active=True
    )
    entity = db_session.scalar(select(Entity).where(Entity.code == "EMB_IN"))
    db_session.add(pending)
    db_session.commit()
    db_session.refresh(pending)

    r = c.patch(
        f"/admin/users/{pending.id}",
        json={"role": "ANALYST", "entity_id_scope": str(entity.id)},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "ANALYST"
    assert body["entity_id_scope"] == str(entity.id)

    db_session.expire_all()
    audit = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.entity_id == pending.id)
        .where(AuditLog.action == "user_role_changed")
    )
    assert audit is not None
    assert audit.before["role"] == "PENDING"
    assert audit.after["role"] == "ANALYST"


def test_patch_analyst_requires_entity_scope() -> None:
    c = _admin_client()
    # Create a PENDING user via a second callback, then re-auth as admin
    c.cookies.clear()
    c.get("/auth/google/callback", headers={"X-Stub-Email": "needsscope@emb.global"})
    c.cookies.clear()
    c.get("/auth/google/callback", headers={"X-Stub-Email": "tejaswa.sharma@emb.global"})

    r = c.get("/admin/users?status=PENDING")
    targets = [u for u in r.json() if u["email"] == "needsscope@emb.global"]
    assert targets
    uid = targets[0]["id"]

    r = c.patch(
        f"/admin/users/{uid}",
        json={"role": "ANALYST", "entity_id_scope": None},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "analyst_requires_entity_scope"


def test_patch_cannot_demote_self() -> None:
    c = _admin_client()
    r = c.get("/auth/me")
    admin_id = r.json()["id"]
    r = c.patch(f"/admin/users/{admin_id}", json={"role": "ANALYST"})
    assert r.status_code == 400
    assert r.json()["detail"] == "cannot_demote_self"


def test_patch_cannot_deactivate_self() -> None:
    c = _admin_client()
    r = c.get("/auth/me")
    admin_id = r.json()["id"]
    r = c.patch(f"/admin/users/{admin_id}", json={"is_active": False})
    assert r.status_code == 400
    assert r.json()["detail"] == "cannot_deactivate_self"


def test_patch_rejects_invalid_entity_id_scope() -> None:
    c = _admin_client()
    c.cookies.clear()
    c.get("/auth/google/callback", headers={"X-Stub-Email": "ent@emb.global"})
    c.cookies.clear()
    c.get("/auth/google/callback", headers={"X-Stub-Email": "tejaswa.sharma@emb.global"})
    r = c.get("/admin/users?status=PENDING")
    target = [u for u in r.json() if u["email"] == "ent@emb.global"][0]
    r = c.patch(
        f"/admin/users/{target['id']}",
        json={
            "role": "ANALYST",
            "entity_id_scope": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"] == "invalid_entity_id_scope"
```

- [ ] **Step 2: Run tests — expect failure (no PATCH endpoint)**

Run: `uv run pytest backend/tests/integration/test_admin_users.py -v`
Expected: FAIL on the new tests (old 5 still green).

- [ ] **Step 3: Add PATCH endpoint**

Edit `backend/src/app/api/routers/admin.py` — append:

```python
import uuid
from fastapi import HTTPException
from sqlalchemy import select as sa_select

from app.core.audit import write_audit_log
from app.db.models.entity import Entity
from app.schemas.user import UserUpdateIn


def _user_snapshot(u: User) -> dict:
    return {
        "email": u.email,
        "role": u.role.value,
        "entity_id_scope": str(u.entity_id_scope) if u.entity_id_scope else None,
        "is_active": u.is_active,
    }


@router.patch("/users/{user_id}", response_model=UserOut)
def patch_user(
    user_id: uuid.UUID,
    payload: UserUpdateIn,
    admin: Annotated[User, Depends(require_role(Role.ADMIN))],
    db: Session = Depends(db_session),
) -> UserOut:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="user_not_found")

    # Self-guards (prevents lockout)
    if target.id == admin.id:
        if payload.role is not None and payload.role != Role.ADMIN:
            raise HTTPException(status_code=400, detail="cannot_demote_self")
        if payload.is_active is False:
            raise HTTPException(status_code=400, detail="cannot_deactivate_self")

    # Determine the effective post-update role for downstream validation
    new_role = payload.role if payload.role is not None else target.role
    new_entity_scope = (
        payload.entity_id_scope
        if "entity_id_scope" in payload.model_fields_set
        else target.entity_id_scope
    )

    # Spec §2 D5: ANALYSTs must be entity-scoped
    if new_role == Role.ANALYST and new_entity_scope is None:
        raise HTTPException(
            status_code=400, detail="analyst_requires_entity_scope"
        )

    # Verify entity_id_scope exists if set
    if new_entity_scope is not None:
        entity = db.get(Entity, new_entity_scope)
        if entity is None:
            raise HTTPException(
                status_code=422, detail="invalid_entity_id_scope"
            )

    before = _user_snapshot(target)

    if payload.role is not None:
        target.role = payload.role
    if "entity_id_scope" in payload.model_fields_set:
        target.entity_id_scope = payload.entity_id_scope
    if payload.is_active is not None:
        target.is_active = payload.is_active

    db.flush()
    after = _user_snapshot(target)

    write_audit_log(
        db,
        actor_user_id=admin.id,
        action="user_role_changed",
        entity_type="user",
        entity_id=target.id,
        before=before,
        after=after,
    )
    db.commit()
    db.refresh(target)
    return UserOut.model_validate(target)
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/integration/test_admin_users.py -v`
Expected: all 12 pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/api/routers/admin.py backend/tests/integration/test_admin_users.py
git commit -m "feat(admin): PATCH /admin/users/{id} with self-guards + audit"
```

---

### Task 24: Full-stack Railway deploy + smoke

**Files:** none in-repo.

- [ ] **Step 1: Push to Railway**

Run: `railway up`
Expected: deploy succeeds.

- [ ] **Step 2: Re-apply any pending migrations**

No new migrations in Day 2/3, but confirm `alembic current` on prod matches `alembic heads`:

```bash
cd backend
DATABASE_URL_DIRECT="<prod direct DSN>" uv run alembic current
DATABASE_URL_DIRECT="<prod direct DSN>" uv run alembic heads
```

Both should print `0002_seed_bootstrap_admin`.

- [ ] **Step 3: Run smoke script**

Run: `./scripts/smoke_prod.sh https://<railway-url>`
Expected: `SMOKE OK`.

- [ ] **Step 4: Manual end-to-end smoke**

In browser, sign in as `tejaswa.sharma@emb.global`:
- `/auth/google/login` → consent → `/`
- `/auth/me` → 200 with `role=ADMIN`
- `/admin/users?status=PENDING` → 200 (possibly empty)
- `/admin/users` → 200 with at least the admin row

Create a test PENDING user by having a colleague sign in (or sign in yourself from a different account if one exists in the workspace). Then:
- `PATCH /admin/users/{their_id}` with `{role:'ANALYST', entity_id_scope:'<EMB_IN uuid>'}` → 200
- Have them hit `/auth/me` → `role=ANALYST`

- [ ] **Step 5: Confirm audit trail**

```bash
# Run directly against prod Neon
uv run python -c "
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
import os
from app.db.models import AuditLog
e = create_engine(os.environ['DATABASE_URL_DIRECT'])
with Session(e) as s:
    for row in s.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(5)):
        print(row.action, row.entity_type, row.created_at)
"
```

Expected: at least one `bootstrap_admin_seeded`, one `user_created`, one `user_role_changed`.

- [ ] **Step 6: No code changes — status commit only**

```bash
git commit --allow-empty -m "chore(m1): full stack live on Railway (day 3)"
```

---

### Task 25: IT ping for SPF + DKIM on `emb.global`

**Files:**
- Create/Modify: `docs/runbook.md` (append a section)

- [ ] **Step 1: Draft the IT request**

Email / Slack to IT:

```
Subject: DNS records needed for receivables-bot@emb.global (M6 prep)

Hi IT,

For the internal Receivables Ageing Dashboard (Milestone 6 delivers
daily CFO + analyst email digests; M1 is the deploy skeleton), I need
two DNS records on emb.global so outbound mail from
receivables-bot@emb.global clears SPF + DKIM on recipients' side.

1. SPF — add Resend's mechanism to the existing SPF TXT record. If
   current record is `v=spf1 include:_spf.google.com ~all`, extend to:
   `v=spf1 include:_spf.google.com include:spf.resend.com ~all`

2. DKIM — add the CNAME Resend gives us once we verify the domain in
   their dashboard. I'll send the exact records after I set up the
   Resend domain; typically one or two CNAMEs named
   `resend._domainkey.emb.global` pointing at Resend's public key.

No change to MX — receiving still goes through Google Workspace.

Timeline: M6 is weeks out, so no rush today, but good to get the
SPF change in now so I can test email delivery end-to-end when I
build the email pipeline.

Thanks,
Tejaswa
```

- [ ] **Step 2: Record the ask in runbook**

Append to `docs/runbook.md`:

```markdown
## M1 IT hand-offs

### DNS records for outbound email (emb.global)
- **Requested:** 2026-04-16
- **Recipient:** IT team
- **Purpose:** prep M6 email digests (CFO + analyst)
- **Status:** awaiting ack / record publication

**Records:**
1. SPF TXT — extend to include `include:spf.resend.com`
2. DKIM CNAME(s) — Resend will emit these after domain verification.
   Verify the domain in Resend before sending the CNAME values to IT.

Until both records are live + verified in Resend, **do not flip any
alert rule to active** (spec §14 — activation is M6, not M1).
```

- [ ] **Step 3: Commit**

```bash
git add docs/runbook.md
git commit -m "docs(runbook): record SPF/DKIM request to IT"
```

---

### Task 26: Coverage check + README tick + final commit

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run full test suite with coverage**

Run: `uv run pytest --cov=backend/src/app/core --cov=backend/src/app/api/routers --cov-report=term-missing backend/tests/ -v`
Expected:
- All tests pass (~25+ tests)
- Coverage on `app/core/` + `app/api/routers/` ≥ 90%

If any critical branch is uncovered, add a targeted test before ticking complete.

- [ ] **Step 2: Run ruff + black + mypy**

Run: `uv run ruff check . && uv run black --check . && uv run mypy backend/src`
Expected: all green.

- [ ] **Step 3: Update README**

Edit `README.md`. Find the M1 checklist and tick every line:

```markdown
## Milestone 1 — Foundations + Deploy Skeleton — DONE ✓

- [x] Alembic migrations: entities, users, fx_rates, audit_log
- [x] Bootstrap admin seed (tejaswa.sharma@emb.global → ADMIN)
- [x] Google SSO with domain lock (@emb.global)
- [x] Four-role RBAC (ANALYST / CFO / ADMIN / PENDING)
- [x] PENDING-by-default user lifecycle
- [x] Admin approval endpoints (GET /admin/users, PATCH /admin/users/{id})
- [x] audit_log wired to every role change
- [x] /health deployed to Railway (day 1)
- [x] SSO end-to-end on Railway (day 2)
- [x] Full stack on Railway (day 3)
- [x] SPF + DKIM ask sent to IT
- [x] ~25 tests + smoke script, ≥90% coverage on app/core + app/api/routers

**Deployed:** <Railway URL>
```

- [ ] **Step 4: Final commit**

```bash
git add README.md
git commit -m "chore(m1): mark M1 complete"
```

- [ ] **Step 5: Tag**

```bash
git tag -a m1-complete -m "M1 Foundations + Deploy Skeleton complete"
```

---

## Done

M1 is complete when:
- Every task above has every step ticked
- CI / local `pytest` is fully green
- Railway URL returns 200 on `/health`
- `tejaswa.sharma@emb.global` can sign in, see admin endpoints, promote PENDING users, all with audit trail

**Next:** Milestone 2 — Wireframes (spec §14). Note: per D23, M4 (dashboard React) cannot start before M2 wireframes are signed off. M1 → M2 is unblocked.
