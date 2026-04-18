"""Config service — /config/credit-period and /config/aliases CRUD (M3 Task 6).

Implements business logic for both credit_period_config and party_aliases
management (spec §3, §10).

Public interface::

    # Credit period
    list_credit_periods(db, entity_code, include_closed, party_name_contains,
                        page, page_size, current_user) -> CreditPeriodListResponse
    create_credit_period(db, body, current_user) -> CreditPeriodRow
    patch_credit_period(db, config_id, body, current_user) -> CreditPeriodRow

    # Aliases
    list_aliases(db, entity_code, canonical_id, alias_text_contains,
                 page, page_size, current_user) -> AliasListResponse
    create_alias(db, body, current_user) -> AliasRow
    patch_alias(db, alias_id, body, current_user) -> AliasRow
    delete_alias(db, alias_id, current_user) -> None

Design decisions:
- All mutations commit once at the end. Rollback on error.
- RBAC + entity scope checked at service layer too (not just route dep).
- No raw party names / alias text in structlog fields — aggregate counts only.
- valid_from is required from the client; no date.today() reads here (CLAUDE.md).
- PATCH credit-period allows editing credit_days + reason_note on the OPEN row only.
  Versioning (audit trail) is done by POST (closes prior, inserts new).
- DELETE alias is hard-delete. Does NOT cascade to invoice.canonical_id.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.credit_period_config import CreditPeriodConfig
from app.db.models.entity import Entity
from app.db.models.party import PartyAlias, PartyCanonical
from app.schemas.config import (
    AliasCreateRequest,
    AliasListResponse,
    AliasPatchRequest,
    AliasRow,
    CreditPeriodCreateRequest,
    CreditPeriodListResponse,
    CreditPeriodPatchRequest,
    CreditPeriodRow,
    PaginationMeta,
)

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.orm import Session

    from app.db.models.user import User

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_entity_by_code(db: Session, entity_code: str) -> Entity:
    entity = db.scalar(select(Entity).where(Entity.code == entity_code))
    if entity is None:
        raise HTTPException(status_code=400, detail=f"Entity code '{entity_code}' not found.")
    return entity


def _check_analyst_entity_scope(current_user: User, entity_id: uuid.UUID) -> None:
    """Raise 403 if ANALYST is out of scope for the given entity."""
    if (
        current_user.role == Role.ANALYST
        and current_user.entity_id_scope is not None
        and current_user.entity_id_scope != entity_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this entity.",
        )


def _check_read_rbac(current_user: User) -> None:
    """PENDING → 403. CFO/ANALYST/ADMIN may read."""
    if current_user.role == Role.PENDING:
        raise HTTPException(status_code=403, detail="Insufficient permissions.")


def _check_write_rbac(current_user: User) -> None:
    """CFO/PENDING → 403. ANALYST (entity-scoped) and ADMIN may write."""
    if current_user.role in (Role.CFO, Role.PENDING):
        raise HTTPException(status_code=403, detail="Insufficient permissions.")


def _check_admin_only(current_user: User) -> None:
    """Only ADMIN allowed; everyone else → 403."""
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="Admin role required.")


def _credit_period_to_row(cfg: CreditPeriodConfig, entity_code: str) -> CreditPeriodRow:
    return CreditPeriodRow(
        id=cfg.id,
        canonical_id=cfg.canonical_id,
        canonical_name=cfg.canonical.name,
        entity_code=entity_code,
        credit_days=cfg.days,
        reason_note=cfg.reason_note,
        valid_from=cfg.valid_from,
        valid_to=cfg.valid_to,
        created_by=cfg.updated_by,  # spec uses updated_by (DDL name)
        created_at=cfg.updated_at,
    )


def _alias_to_row(alias: PartyAlias, entity_code: str) -> AliasRow:
    return AliasRow(
        id=alias.id,
        canonical_id=alias.canonical_id,
        canonical_name=alias.canonical.name,
        entity_code=entity_code,
        alias_text=alias.alias_text,
        source=alias.source,
        created_by=alias.created_by,
        created_at=alias.created_at,
    )


def _paginate(total: int, page: int, page_size: int) -> PaginationMeta:
    total_pages = max(1, math.ceil(total / page_size)) if total > 0 else 1
    return PaginationMeta(page=page, page_size=page_size, total=total, total_pages=total_pages)


# ---------------------------------------------------------------------------
# Credit period — list
# ---------------------------------------------------------------------------


def list_credit_periods(
    db: Session,
    entity_code: str | None,
    include_closed: bool,
    party_name_contains: str | None,
    page: int,
    page_size: int,
    current_user: User,
) -> CreditPeriodListResponse:
    """List credit_period_config rows with optional filters.

    RBAC: ANALYST (own-entity scope), ADMIN (any), CFO (read all). PENDING → 403.
    """
    _check_read_rbac(current_user)

    # Determine which entities this user can see
    query = (
        select(CreditPeriodConfig, Entity.code.label("entity_code"))
        .join(PartyCanonical, CreditPeriodConfig.canonical_id == PartyCanonical.id)
        .join(Entity, PartyCanonical.entity_id == Entity.id)
    )

    # ANALYST: restrict to entity scope
    if current_user.role == Role.ANALYST and current_user.entity_id_scope is not None:
        query = query.where(PartyCanonical.entity_id == current_user.entity_id_scope)

    if entity_code is not None:
        query = query.where(Entity.code == entity_code)

    if not include_closed:
        query = query.where(CreditPeriodConfig.valid_to.is_(None))

    if party_name_contains:
        query = query.where(PartyCanonical.name.ilike(f"%{party_name_contains}%"))

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total: int = db.scalar(count_q) or 0

    # Paginated fetch
    offset = (page - 1) * page_size
    rows = db.execute(
        query.order_by(CreditPeriodConfig.valid_from.desc()).offset(offset).limit(page_size)
    ).all()

    items = [_credit_period_to_row(row.CreditPeriodConfig, row.entity_code) for row in rows]

    return CreditPeriodListResponse(
        items=items,
        pagination=_paginate(total, page, page_size),
    )


# ---------------------------------------------------------------------------
# Credit period — create
# ---------------------------------------------------------------------------


def create_credit_period(
    db: Session,
    body: CreditPeriodCreateRequest,
    current_user: User,
) -> CreditPeriodRow:
    """Create a new credit_period_config row.

    Flow:
    1. RBAC check (ANALYST/ADMIN; CFO/PENDING → 403).
    2. Load canonical; verify entity scope.
    3. Close prior open row if exists.
    4. Insert new row.
    5. Audit log.
    6. Commit and return.
    """
    _check_write_rbac(current_user)

    # Load canonical + entity
    canonical = db.get(PartyCanonical, body.canonical_id)
    if canonical is None:
        raise HTTPException(
            status_code=404,
            detail=f"Canonical party {body.canonical_id} not found.",
        )

    entity = db.get(Entity, canonical.entity_id)
    if entity is None:
        raise HTTPException(status_code=500, detail="Entity not found for canonical.")

    _check_analyst_entity_scope(current_user, canonical.entity_id)

    # Find and close prior open row
    prior_open = db.scalar(
        select(CreditPeriodConfig).where(
            CreditPeriodConfig.canonical_id == body.canonical_id,
            CreditPeriodConfig.valid_to.is_(None),
        )
    )

    before_json: dict[str, Any] = {}
    if prior_open is not None:
        from datetime import timedelta

        prior_open.valid_to = body.valid_from - timedelta(days=1)
        before_json = {
            "credit_days": prior_open.days,
            "valid_from": prior_open.valid_from.isoformat(),
            "config_id": str(prior_open.id),
        }
        db.flush()

    # Insert new row
    new_cfg = CreditPeriodConfig(
        canonical_id=body.canonical_id,
        days=body.credit_days,
        reason_note=body.reason_note,
        valid_from=body.valid_from,
        valid_to=None,
        updated_by=current_user.id,
    )
    db.add(new_cfg)
    db.flush()

    # Audit log
    audit = AuditLog(
        action="credit_period_config.create",
        entity_type="credit_period_config",
        entity_id=new_cfg.id,
        actor_user_id=current_user.id,
        before=before_json,
        after={
            "credit_days": body.credit_days,
            "valid_from": body.valid_from.isoformat(),
            "canonical_id": str(body.canonical_id),
        },
    )
    db.add(audit)
    db.commit()

    log.info(
        "config_service.create_credit_period",
        entity_id=str(canonical.entity_id),
        prior_closed=prior_open is not None,
    )

    # Refresh to load relationships
    db.refresh(new_cfg)
    return _credit_period_to_row(new_cfg, entity.code)


# ---------------------------------------------------------------------------
# Credit period — patch (OPEN row only, ADMIN only)
# ---------------------------------------------------------------------------


def patch_credit_period(
    db: Session,
    config_id: uuid.UUID,
    body: CreditPeriodPatchRequest,
    current_user: User,
) -> CreditPeriodRow:
    """Update the OPEN credit_period_config row (valid_to IS NULL). ADMIN only.

    Analysts must create new rows for versioning; PATCH is ADMIN-only
    to handle data corrections without creating unnecessary version noise.
    """
    _check_admin_only(current_user)

    cfg = db.get(CreditPeriodConfig, config_id)
    if cfg is None:
        raise HTTPException(
            status_code=404,
            detail=f"CreditPeriodConfig {config_id} not found.",
        )

    if cfg.valid_to is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CREDIT_PERIOD_ROW_CLOSED",
                "detail": (
                    "Only the open row (valid_to IS NULL) may be PATCHed. "
                    "Create a new row via POST to update credit terms."
                ),
            },
        )

    entity = db.get(Entity, cfg.canonical.entity_id)
    entity_code = entity.code if entity else "UNKNOWN"

    before_json = {
        "credit_days": cfg.days,
        "reason_note": cfg.reason_note,
    }

    if body.credit_days is not None:
        cfg.days = body.credit_days
    # reason_note: None means "no change". To clear, pass empty string.
    if body.reason_note is not None:
        cfg.reason_note = body.reason_note if body.reason_note != "" else None
    cfg.updated_by = current_user.id

    db.flush()

    audit = AuditLog(
        action="credit_period_config.update",
        entity_type="credit_period_config",
        entity_id=cfg.id,
        actor_user_id=current_user.id,
        before=before_json,
        after={
            "credit_days": cfg.days,
            "reason_note": cfg.reason_note,
        },
    )
    db.add(audit)
    db.commit()

    db.refresh(cfg)
    return _credit_period_to_row(cfg, entity_code)


# ---------------------------------------------------------------------------
# Aliases — list
# ---------------------------------------------------------------------------


def list_aliases(
    db: Session,
    entity_code: str | None,
    canonical_id: uuid.UUID | None,
    alias_text_contains: str | None,
    page: int,
    page_size: int,
    current_user: User,
) -> AliasListResponse:
    """List party_aliases with optional filters.

    RBAC: ANALYST (own entity), ADMIN, CFO (read all). PENDING → 403.
    """
    _check_read_rbac(current_user)

    query = (
        select(PartyAlias, Entity.code.label("entity_code"))
        .join(PartyCanonical, PartyAlias.canonical_id == PartyCanonical.id)
        .join(Entity, PartyCanonical.entity_id == Entity.id)
    )

    # ANALYST: restrict to entity scope
    if current_user.role == Role.ANALYST and current_user.entity_id_scope is not None:
        query = query.where(PartyCanonical.entity_id == current_user.entity_id_scope)

    if entity_code is not None:
        query = query.where(Entity.code == entity_code)

    if canonical_id is not None:
        query = query.where(PartyAlias.canonical_id == canonical_id)

    if alias_text_contains:
        query = query.where(PartyAlias.alias_text.ilike(f"%{alias_text_contains}%"))

    count_q = select(func.count()).select_from(query.subquery())
    total: int = db.scalar(count_q) or 0

    offset = (page - 1) * page_size
    rows = db.execute(
        query.order_by(PartyAlias.created_at.desc()).offset(offset).limit(page_size)
    ).all()

    items = [_alias_to_row(row.PartyAlias, row.entity_code) for row in rows]

    return AliasListResponse(
        items=items,
        pagination=_paginate(total, page, page_size),
    )


# ---------------------------------------------------------------------------
# Aliases — create
# ---------------------------------------------------------------------------


def create_alias(
    db: Session,
    body: AliasCreateRequest,
    current_user: User,
) -> AliasRow:
    """Create a MANUAL alias.

    Flow:
    1. RBAC (ANALYST/ADMIN; CFO/PENDING → 403).
    2. Load canonical; verify entity scope.
    3. Normalise alias_text (strip whitespace).
    4. Insert; catch UNIQUE violation → 409 ALIAS_ALREADY_EXISTS.
    5. Audit log.
    6. Commit and return.
    """
    _check_write_rbac(current_user)

    canonical = db.get(PartyCanonical, body.canonical_id)
    if canonical is None:
        raise HTTPException(
            status_code=404,
            detail=f"Canonical party {body.canonical_id} not found.",
        )

    entity = db.get(Entity, canonical.entity_id)
    if entity is None:
        raise HTTPException(status_code=500, detail="Entity not found for canonical.")

    _check_analyst_entity_scope(current_user, canonical.entity_id)

    alias_text_norm = body.alias_text.strip()
    if not alias_text_norm:
        raise HTTPException(status_code=422, detail="alias_text must be non-empty after stripping.")

    # Check for existing UNIQUE(alias_text, canonical_id)
    existing = db.scalar(
        select(PartyAlias).where(
            PartyAlias.alias_text == alias_text_norm,
            PartyAlias.canonical_id == body.canonical_id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ALIAS_ALREADY_EXISTS",
                "detail": "An alias with this text already exists for the given canonical party.",
            },
        )

    new_alias = PartyAlias(
        canonical_id=body.canonical_id,
        alias_text=alias_text_norm,
        source="MANUAL",
        confidence=None,
        confirmed_by=None,
        confirmed_at=None,
        created_by=current_user.id,
    )
    db.add(new_alias)
    db.flush()

    audit = AuditLog(
        action="alias.create",
        entity_type="party_aliases",
        entity_id=new_alias.id,
        actor_user_id=current_user.id,
        before={},
        after={
            "canonical_id": str(body.canonical_id),
            "source": "MANUAL",
        },
    )
    db.add(audit)
    db.commit()

    log.info(
        "config_service.create_alias",
        entity_id=str(canonical.entity_id),
    )

    db.refresh(new_alias)
    return _alias_to_row(new_alias, entity.code)


# ---------------------------------------------------------------------------
# Aliases — patch (ADMIN only)
# ---------------------------------------------------------------------------


def patch_alias(
    db: Session,
    alias_id: uuid.UUID,
    body: AliasPatchRequest,
    current_user: User,
) -> AliasRow:
    """Update alias_text. ADMIN only."""
    _check_admin_only(current_user)

    alias = db.get(PartyAlias, alias_id)
    if alias is None:
        raise HTTPException(status_code=404, detail=f"Alias {alias_id} not found.")

    entity = db.get(Entity, alias.canonical.entity_id)
    entity_code = entity.code if entity else "UNKNOWN"

    alias_text_norm = body.alias_text.strip()
    if not alias_text_norm:
        raise HTTPException(status_code=422, detail="alias_text must be non-empty after stripping.")

    # Check UNIQUE constraint for the new text (exclude self)
    conflict = db.scalar(
        select(PartyAlias).where(
            PartyAlias.alias_text == alias_text_norm,
            PartyAlias.canonical_id == alias.canonical_id,
            PartyAlias.id != alias_id,
        )
    )
    if conflict is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ALIAS_ALREADY_EXISTS",
                "detail": "An alias with this text already exists for the given canonical party.",
            },
        )

    before_json = {"alias_text": "<redacted>"}  # no raw names in audit log

    alias.alias_text = alias_text_norm
    db.flush()

    audit = AuditLog(
        action="alias.update",
        entity_type="party_aliases",
        entity_id=alias.id,
        actor_user_id=current_user.id,
        before=before_json,
        after={"alias_text": "<redacted>"},  # no raw names in audit log
    )
    db.add(audit)
    db.commit()

    db.refresh(alias)
    return _alias_to_row(alias, entity_code)


# ---------------------------------------------------------------------------
# Aliases — delete (ADMIN only, hard delete)
# ---------------------------------------------------------------------------


def delete_alias(
    db: Session,
    alias_id: uuid.UUID,
    current_user: User,
) -> None:
    """Hard-delete an alias. ADMIN only.

    Does NOT cascade to invoices.canonical_id — published invoices keep
    their resolved canonical. Only future uploads lose the alias match.
    Audit log records the deleted row's full payload in before_json.
    """
    _check_admin_only(current_user)

    alias = db.get(PartyAlias, alias_id)
    if alias is None:
        raise HTTPException(status_code=404, detail=f"Alias {alias_id} not found.")

    before_json = {
        "id": str(alias.id),
        "canonical_id": str(alias.canonical_id),
        "source": alias.source,
        # alias_text intentionally redacted — CLAUDE.md data-handling rule
        "alias_text": "<redacted>",
    }

    audit = AuditLog(
        action="alias.delete",
        entity_type="party_aliases",
        entity_id=alias.id,
        actor_user_id=current_user.id,
        before=before_json,
        after={},
    )
    db.add(audit)
    db.delete(alias)
    db.commit()

    log.info(
        "config_service.delete_alias",
        alias_id=str(alias_id),
    )
