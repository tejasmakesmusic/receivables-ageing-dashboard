"""Admin routes — user list, approve, deactivate, reactivate.

All endpoints require Role.ADMIN. Mutations write an AuditLog row (spec §9).
POST endpoints return 303 redirects so they work from plain HTML forms without
a JS layer (M4 dashboard not yet built — spec D23).
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, require_role
from app.core.logging import get_logger
from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.user import User

log = get_logger(__name__)
router = APIRouter()
_TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parents[2] / "templates"))

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
    users = session.query(User).order_by(User.created_at.desc()).all()
    return _TEMPLATES.TemplateResponse(
        request,
        "admin/users.html",
        {"users": users},
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
        id=uuid.uuid4(),
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

    before = {"role": user.role.value, "is_active": user.is_active}
    user.is_active = False

    audit = AuditLog(
        id=uuid.uuid4(),
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

    before = {"role": user.role.value, "is_active": user.is_active}
    user.is_active = True

    audit = AuditLog(
        id=uuid.uuid4(),
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
