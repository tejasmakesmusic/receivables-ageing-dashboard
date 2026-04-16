"""Shared FastAPI dependencies — DB session, current user, RBAC gates.

Implements get_current_user (session cookie-based auth) and require_role
(role-based access control) per spec §2 D5 + D11.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Depends, HTTPException, Request

from app.core.session import read_session_cookie
from app.db.models.user import User
from app.db.session import get_db

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator

    from sqlalchemy.orm import Session

    from app.core.rbac import Role


def db_session() -> Iterator[Session]:
    """Re-export of `get_db` at the API boundary."""
    yield from get_db()


def get_current_user(
    request: Request, session: Session = Depends(db_session)  # noqa: B008
) -> User:
    """Extract and validate the current user from the session cookie.

    Steps:
      1. Read the signed session cookie from the request.
      2. If missing or invalid → 401 Not authenticated.
      3. Look up the user in the DB by session_data.user_id.
      4. If not found → 401 User not found.
      5. If is_active == False → 403 Account deactivated.
      6. Return the User ORM object.

    Args:
        request: Starlette Request to read the cookie from.
        session: SQLAlchemy session (injected by FastAPI).

    Returns:
        The authenticated User ORM object.

    Raises:
        HTTPException: 401 if cookie missing/invalid or user not found.
                       403 if user account is deactivated.
    """
    # Read session cookie — returns None if missing, expired, or tampered
    session_data = read_session_cookie(request)
    if not session_data:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Look up user in DB by the UUID embedded in the cookie
    user = session.get(User, session_data.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Reject deactivated accounts (admin can flip is_active=False)
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    return user


def require_role(*roles: Role) -> Callable[[User], User]:
    """RBAC dependency factory: requires user to have one of the specified roles.

    Returns a FastAPI dependency function that:
      - Injects get_current_user to retrieve the authenticated user.
      - Checks that user.role is in the allowed roles.
      - Raises 403 if role mismatch.
      - Returns the user if role check passes.

    Args:
        *roles: One or more Role values the user must have.

    Returns:
        A callable that FastAPI will invoke as a dependency.

    Raises:
        HTTPException: 403 if user.role not in roles.

    Usage:
        @router.get("/admin")
        def admin_endpoint(user: User = Depends(require_role(Role.ADMIN))):
            ...
    """

    def check_role(user: User = Depends(get_current_user)) -> User:  # noqa: B008
        """Inner dependency: check that user.role is in allowed roles."""
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    # Guard against callers passing plain strings instead of Role enum members.
    # Fail at definition time (startup) so misuse is caught before a request lands.
    from app.core.rbac import Role as _Role  # local import avoids module-level circular dep

    if not all(isinstance(r, _Role) for r in roles):
        raise TypeError(f"require_role() expects Role enum values, got: {roles!r}")

    return check_role


__all__ = ["db_session", "get_current_user", "require_role"]
