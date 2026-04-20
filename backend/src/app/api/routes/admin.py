"""Admin routes — user list, approve, deactivate, reactivate, exception buckets,
audit log, email outbox (M1+M6).

All endpoints require Role.ADMIN unless noted. Mutations write an AuditLog row (spec §9).
HTML user-mgmt POST endpoints return 303 redirects for form compatibility (M1).
JSON API endpoints added in M6 for exception buckets, audit log, email outbox.
"""

from __future__ import annotations

import uuid  # noqa: TCH003 — uuid.UUID used at runtime in path param type hints
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import func, select
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.logging import get_logger
from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.email_outbox import EmailOutbox
from app.db.models.email_rule import EmailRule
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.user import User
from app.schemas.admin import (
    AuditLogListResponse,
    AuditLogRow,
    EmailOutboxListResponse,
    EmailOutboxMarkSentRequest,
    EmailOutboxMarkSentResponse,
    EmailOutboxRow,
    ExceptionBucketCreateRequest,
    ExceptionBucketListResponse,
    ExceptionBucketPatchRequest,
    ExceptionBucketRow,
)
from app.schemas.email_rule import EmailRuleListResponse, EmailRulePatchRequest, EmailRuleRow

log = get_logger(__name__)
router = APIRouter()
_TEMPLATES = Jinja2Templates(
    env=Environment(
        loader=FileSystemLoader(str(Path(__file__).parents[2] / "templates")),
        autoescape=select_autoescape(["html"]),
    )
)
_admin_only = require_role(Role.ADMIN)

# Roles that an admin is allowed to assign via the approval form.
_ASSIGNABLE_ROLES = {Role.ANALYST, Role.CFO, Role.ADMIN}

_ADMIN_USERS_REDIRECT = "/admin/users"


@router.get("/users", response_class=HTMLResponse)
def list_users(
    request: Request,
    session: Annotated[Session, Depends(db_session)],
    _current_user: Annotated[User, Depends(require_role(Role.ADMIN))],
) -> HTMLResponse:
    """Render the user management page (admin only)."""
    users = list(session.scalars(select(User).order_by(User.created_at.desc())))
    csrf_token = request.cookies.get("csrf_token", "")
    return _TEMPLATES.TemplateResponse(
        request,
        "admin/users.html",
        {"users": users, "csrf_token": csrf_token},
    )


@router.post("/users/{user_id}/approve")
def approve_user(
    user_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)],
    current_user: Annotated[User, Depends(require_role(Role.ADMIN))],
    role: Annotated[Role, Form()],
) -> RedirectResponse:
    """Approve a PENDING user and assign them a role.

    Raises:
        HTTPException: 422 if role is PENDING (cannot approve into PENDING).
        HTTPException: 404 if user not found.
    """
    if role == Role.PENDING:
        raise HTTPException(status_code=422, detail="Cannot approve user into PENDING role")

    if role not in _ASSIGNABLE_ROLES:
        raise HTTPException(status_code=422, detail=f"Role {role!r} is not assignable")

    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    before = {"role": user.role.value, "is_active": user.is_active}
    user.role = role
    user.is_active = True

    audit = AuditLog(
        action="role_change",
        entity_type="users",
        entity_id=user.id,
        actor_user_id=current_user.id,
        before=before,
        after={"role": user.role.value, "is_active": user.is_active},
    )
    session.add(audit)
    session.commit()

    log.info("admin.user_approved", user_id=str(user_id), new_role=role.value)
    return RedirectResponse(url=_ADMIN_USERS_REDIRECT, status_code=303)


@router.post("/users/{user_id}/deactivate")
def deactivate_user(
    user_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)],
    current_user: Annotated[User, Depends(require_role(Role.ADMIN))],
) -> RedirectResponse:
    """Deactivate an active user account.

    Raises:
        HTTPException: 404 if user not found.
    """
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(status_code=422, detail="Cannot deactivate your own account")

    if not user.is_active:
        return RedirectResponse(url=_ADMIN_USERS_REDIRECT, status_code=303)

    before = {"role": user.role.value, "is_active": user.is_active}
    user.is_active = False

    audit = AuditLog(
        action="user_deactivate",
        entity_type="users",
        entity_id=user.id,
        actor_user_id=current_user.id,
        before=before,
        after={"role": user.role.value, "is_active": user.is_active},
    )
    session.add(audit)
    session.commit()

    log.info("admin.user_deactivated", user_id=str(user_id))
    return RedirectResponse(url=_ADMIN_USERS_REDIRECT, status_code=303)


@router.post("/users/{user_id}/reactivate")
def reactivate_user(
    user_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)],
    current_user: Annotated[User, Depends(require_role(Role.ADMIN))],
) -> RedirectResponse:
    """Reactivate a previously deactivated user account.

    Raises:
        HTTPException: 404 if user not found.
    """
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.is_active:
        return RedirectResponse(url=_ADMIN_USERS_REDIRECT, status_code=303)

    before = {"role": user.role.value, "is_active": user.is_active}
    user.is_active = True

    audit = AuditLog(
        action="user_reactivate",
        entity_type="users",
        entity_id=user.id,
        actor_user_id=current_user.id,
        before=before,
        after={"role": user.role.value, "is_active": user.is_active},
    )
    session.add(audit)
    session.commit()

    log.info("admin.user_reactivated", user_id=str(user_id))
    return RedirectResponse(url=_ADMIN_USERS_REDIRECT, status_code=303)


# ===========================================================================
# Exception buckets (A3) — M6
# ===========================================================================


@router.get(
    "/exception-buckets",
    response_model=ExceptionBucketListResponse,
    status_code=200,
    summary="List exception bucket types (A3)",
    tags=["admin"],
)
def list_exception_buckets(
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(require_role(Role.ANALYST, Role.ADMIN, Role.CFO))] = ...,  # type: ignore[assignment]
) -> ExceptionBucketListResponse:
    """List all exception bucket types including D9 seeds and admin-added ones.

    All non-PENDING roles can read. ADMIN only for writes.

    Returns:
        200 with ExceptionBucketListResponse.
    """
    rows = session.scalars(
        select(ExceptionBucketType).order_by(ExceptionBucketType.created_at)
    ).all()

    items = [
        ExceptionBucketRow(
            id=r.id,
            code=r.code,
            name=r.name,
            description=r.description,
            active=r.active,
            created_at=r.created_at,
        )
        for r in rows
    ]

    return ExceptionBucketListResponse(items=items, total=len(items))


@router.post(
    "/exception-buckets",
    response_model=ExceptionBucketRow,
    status_code=201,
    summary="Create a new exception bucket type (ADMIN only, A3)",
    tags=["admin"],
)
def create_exception_bucket(
    body: ExceptionBucketCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> ExceptionBucketRow:
    """Create a new exception bucket type. ADMIN only.

    code is immutable after creation. Duplicate code → 409.

    Returns:
        201 with ExceptionBucketRow.
    """
    # Normalize code
    code = body.code.strip().upper()

    existing = session.scalar(select(ExceptionBucketType).where(ExceptionBucketType.code == code))
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "BUCKET_CODE_DUPLICATE",
                "detail": f"Exception bucket type with code '{code}' already exists.",
            },
        )

    bucket = ExceptionBucketType(
        code=code,
        name=body.name,
        description=body.description,
        active=True,
    )
    session.add(bucket)
    session.flush()

    audit = AuditLog(
        action="exception_bucket.create",
        entity_type="exception_bucket_types",
        entity_id=bucket.id,
        actor_user_id=current_user.id,
        before=None,
        after={"code": code, "name": body.name, "active": True},
    )
    session.add(audit)
    session.commit()

    log.info("admin.exception_bucket_create", code=code)

    return ExceptionBucketRow(
        id=bucket.id,
        code=bucket.code,
        name=bucket.name,
        description=bucket.description,
        active=bucket.active,
        created_at=bucket.created_at,
    )


@router.patch(
    "/exception-buckets/{bucket_id}",
    response_model=ExceptionBucketRow,
    status_code=200,
    summary="Update exception bucket type name/description/active (ADMIN only, A3)",
    tags=["admin"],
)
def patch_exception_bucket(
    bucket_id: uuid.UUID,
    body: ExceptionBucketPatchRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> ExceptionBucketRow:
    """Update name, description, or active status. ADMIN only.

    code is IMMUTABLE after creation.

    Returns:
        200 with ExceptionBucketRow.

    Raises:
        404: Bucket type not found.
    """
    bucket = session.get(ExceptionBucketType, bucket_id)
    if bucket is None:
        raise HTTPException(status_code=404, detail=f"Exception bucket {bucket_id} not found.")

    before = {"name": bucket.name, "description": bucket.description, "active": bucket.active}

    if body.active is not None:
        bucket.active = body.active
    if body.name is not None:
        bucket.name = body.name
    if body.description is not None:
        bucket.description = body.description

    audit = AuditLog(
        action="exception_bucket.update",
        entity_type="exception_bucket_types",
        entity_id=bucket_id,
        actor_user_id=current_user.id,
        before=before,
        after={"name": bucket.name, "description": bucket.description, "active": bucket.active},
    )
    session.add(audit)
    session.commit()

    log.info("admin.exception_bucket_update", bucket_id=str(bucket_id))

    return ExceptionBucketRow(
        id=bucket.id,
        code=bucket.code,
        name=bucket.name,
        description=bucket.description,
        active=bucket.active,
        created_at=bucket.created_at,
    )


# ===========================================================================
# Audit log (A5) — M6
# ===========================================================================


@router.get(
    "/audit-log",
    response_model=AuditLogListResponse,
    status_code=200,
    summary="Paginated audit log (ADMIN only, A5)",
    tags=["admin"],
)
def list_audit_log(
    actor_id: Annotated[uuid.UUID | None, Query(description="Filter by actor user UUID")] = None,
    action: Annotated[str | None, Query(description="Filter by action string")] = None,
    entity_type: Annotated[str | None, Query(description="Filter by entity_type")] = None,
    ts_from: Annotated[
        str | None, Query(description="Filter by created_at >= (ISO datetime)")
    ] = None,
    ts_to: Annotated[
        str | None, Query(description="Filter by created_at <= (ISO datetime)")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> AuditLogListResponse:
    """Return paginated audit log. ADMIN only.

    Returns:
        200 with AuditLogListResponse.
    """
    query = select(AuditLog)

    if actor_id:
        query = query.where(AuditLog.actor_user_id == actor_id)
    if action:
        query = query.where(AuditLog.action == action)
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if ts_from:
        try:
            dt_from = datetime.fromisoformat(ts_from)
            query = query.where(AuditLog.created_at >= dt_from)
        except ValueError:
            raise HTTPException(
                status_code=422, detail=f"Invalid ts_from format: {ts_from}"
            ) from None
    if ts_to:
        try:
            dt_to = datetime.fromisoformat(ts_to)
            query = query.where(AuditLog.created_at <= dt_to)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid ts_to format: {ts_to}") from None

    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        query.order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items = [
        AuditLogRow(
            id=r.id,
            actor_user_id=r.actor_user_id,
            actor_email=r.actor.email if r.actor else None,
            action=r.action,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            before=r.before,
            after=r.after,
            created_at=r.created_at,
        )
        for r in rows
    ]

    return AuditLogListResponse(items=items, total=total, page=page, page_size=page_size)


# ===========================================================================
# Email outbox (A2) — M6
# ===========================================================================


@router.get(
    "/email-outbox",
    response_model=EmailOutboxListResponse,
    status_code=200,
    summary="List email outbox rows (ADMIN only, A2)",
    tags=["admin"],
)
def list_email_outbox(
    status: Annotated[
        str | None,
        Query(description="Filter by status: QUEUED, SENT, FAILED"),
    ] = None,
    rule_type: Annotated[
        str | None,
        Query(description="Filter by rule_type: DAILY_DIGEST, PUBLISH_NOTIF"),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> EmailOutboxListResponse:
    """List email_outbox rows for drain-cron visibility. ADMIN only.

    Returns:
        200 with EmailOutboxListResponse.
    """
    query = select(EmailOutbox)
    if status:
        query = query.where(EmailOutbox.status == status)
    if rule_type:
        query = query.where(EmailOutbox.rule_type == rule_type)

    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = session.scalars(
        query.order_by(EmailOutbox.enqueued_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    items = [
        EmailOutboxRow(
            id=r.id,
            rule_type=r.rule_type,
            snapshot_id=r.snapshot_id,
            subject=r.subject,
            status=r.status,
            attempts=r.attempts,
            enqueued_at=r.enqueued_at,
            sent_at=r.sent_at,
            last_error=r.last_error,
        )
        for r in rows
    ]

    return EmailOutboxListResponse(items=items, total=total, page=page, page_size=page_size)


@router.post(
    "/email-outbox/{outbox_id}/mark-sent",
    response_model=EmailOutboxMarkSentResponse,
    status_code=200,
    summary="Manually mark an email outbox row as SENT (ADMIN only, A2)",
    tags=["admin"],
)
def mark_email_sent(
    outbox_id: uuid.UUID,
    body: EmailOutboxMarkSentRequest | None = None,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> EmailOutboxMarkSentResponse:
    """Manually mark an email outbox row as SENT. ADMIN only.

    This is the 'local drain stub' — lets admins clear the queue during demo
    without SMTP delivery. Audit log records the action.

    Returns:
        200 with EmailOutboxMarkSentResponse.

    Raises:
        404: Outbox row not found.
        409: Already marked as SENT.
    """
    outbox = session.get(EmailOutbox, outbox_id)
    if outbox is None:
        raise HTTPException(status_code=404, detail=f"Email outbox row {outbox_id} not found.")

    if outbox.status == "SENT":
        raise HTTPException(
            status_code=409,
            detail={"code": "ALREADY_SENT", "detail": "Email outbox row is already SENT."},
        )

    now_utc = datetime.now(tz=UTC)
    before = {"status": outbox.status}
    outbox.status = "SENT"
    outbox.sent_at = now_utc

    audit = AuditLog(
        action="email_outbox.mark_sent",
        entity_type="email_outbox",
        entity_id=outbox_id,
        actor_user_id=current_user.id,
        before=before,
        after={"status": "SENT", "note": (body.note if body else None)},
    )
    session.add(audit)
    session.commit()

    log.info("admin.email_outbox_mark_sent", outbox_id=str(outbox_id))

    return EmailOutboxMarkSentResponse(
        id=outbox.id,
        status=outbox.status,
        sent_at=outbox.sent_at,
    )


# ===========================================================================
# Email rules (A2 extension) — Task A.3
# ===========================================================================


@router.get(
    "/email-rules",
    response_model=EmailRuleListResponse,
    status_code=200,
    summary="List email rules (ANALYST/ADMIN/CFO read, A2)",
    tags=["admin"],
)
def list_email_rules(
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[
        User, Depends(require_role(Role.ANALYST, Role.ADMIN, Role.CFO))
    ] = ...,  # type: ignore[assignment]
) -> EmailRuleListResponse:
    """List all email_rules rows. All non-PENDING roles can read.

    Returns:
        200 with EmailRuleListResponse.
    """
    rows = session.scalars(select(EmailRule).order_by(EmailRule.created_at)).all()

    items = [
        EmailRuleRow(
            id=r.id,
            rule_type=r.rule_type,
            recipients_json=r.recipients_json or [],
            cron_schedule=r.cron_schedule,
            is_active=r.is_active,
            entity_filter=r.entity_filter,
            notes=r.notes,
            created_at=r.created_at,
            updated_at=r.updated_at,
            updated_by=r.updated_by,
        )
        for r in rows
    ]

    return EmailRuleListResponse(items=items, total=len(items))


@router.patch(
    "/email-rules/{rule_id}",
    response_model=EmailRuleRow,
    status_code=200,
    summary="Update email rule recipients/schedule/active (ADMIN only, A2)",
    tags=["admin"],
)
def patch_email_rule(
    rule_id: uuid.UUID,
    body: EmailRulePatchRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_admin_only)] = ...,  # type: ignore[assignment]
) -> EmailRuleRow:
    """Partial update of an email rule. ADMIN only.

    rule_type is immutable — identity is selected by path param.
    Writes an audit_log row with action='EMAIL_RULE_UPDATED'.

    Returns:
        200 with updated EmailRuleRow.

    Raises:
        404: Rule not found.
    """
    rule = session.get(EmailRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"Email rule {rule_id} not found.")

    before = {
        "recipients_json": rule.recipients_json,
        "cron_schedule": rule.cron_schedule,
        "is_active": rule.is_active,
        "entity_filter": rule.entity_filter,
        "notes": rule.notes,
    }

    if body.recipients_json is not None:
        rule.recipients_json = body.recipients_json
    if body.cron_schedule is not None:
        rule.cron_schedule = body.cron_schedule
    if body.is_active is not None:
        rule.is_active = body.is_active
    if body.entity_filter is not None:
        rule.entity_filter = body.entity_filter
    if body.notes is not None:
        rule.notes = body.notes
    rule.updated_by = current_user.id

    after = {
        "recipients_json": rule.recipients_json,
        "cron_schedule": rule.cron_schedule,
        "is_active": rule.is_active,
        "entity_filter": rule.entity_filter,
        "notes": rule.notes,
    }

    audit = AuditLog(
        action="EMAIL_RULE_UPDATED",
        entity_type="email_rules",
        entity_id=rule_id,
        actor_user_id=current_user.id,
        before=before,
        after=after,
    )
    session.add(audit)
    session.commit()

    log.info("admin.email_rule_update", rule_id=str(rule_id), rule_type=rule.rule_type)

    return EmailRuleRow(
        id=rule.id,
        rule_type=rule.rule_type,
        recipients_json=rule.recipients_json or [],
        cron_schedule=rule.cron_schedule,
        is_active=rule.is_active,
        entity_filter=rule.entity_filter,
        notes=rule.notes,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
        updated_by=rule.updated_by,
    )
