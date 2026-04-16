"""Signed-cookie session layer (spec §11).

Provides stateless, httponly-only sessions using itsdangerous.URLSafeTimedSerializer.
Payload is kept minimal: user_id, role, entity_id_scope (optional).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import get_settings
from app.core.rbac import Role

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response


@dataclass
class SessionData:
    """Minimal session state: user_id, role, optional entity_id_scope."""

    user_id: uuid.UUID
    role: Role
    entity_id_scope: uuid.UUID | None


def create_session_cookie(data: SessionData, response: Response) -> None:
    """Serialize and set a signed, timestamped session cookie.

    Payload keys are kept short to minimize cookie size.
    Cookie is httponly, same-site=lax, and respects secure flag.

    Args:
        data: Session data to encode.
        response: Starlette Response object to set the cookie on.
    """
    settings = get_settings()

    serializer = URLSafeTimedSerializer(settings.session_secret, salt="emb-session")

    payload = {
        "u": str(data.user_id),
        "r": data.role.value,
        "e": str(data.entity_id_scope) if data.entity_id_scope else None,
    }

    signed_string = serializer.dumps(payload)

    response.set_cookie(
        key="session",
        value=signed_string,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=settings.session_max_age_seconds,
        path="/",
    )


def read_session_cookie(request: Request) -> SessionData | None:
    """Read and verify a signed session cookie.

    Returns None on any error: missing cookie, bad signature, expired,
    or malformed payload. Never raises.

    Args:
        request: Starlette Request object to read the cookie from.

    Returns:
        Reconstructed SessionData or None if cookie is invalid/missing/expired.
    """
    settings = get_settings()

    cookie_value = request.cookies.get("session")
    if not cookie_value:
        return None

    serializer = URLSafeTimedSerializer(settings.session_secret, salt="emb-session")

    try:
        payload = serializer.loads(cookie_value, max_age=settings.session_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
    except Exception:
        # Catch any other deserialization errors (malformed payload, etc.)
        return None

    try:
        user_id = uuid.UUID(payload["u"])
        role = Role(payload["r"])
        entity_id_scope = uuid.UUID(payload["e"]) if payload.get("e") is not None else None

        return SessionData(user_id=user_id, role=role, entity_id_scope=entity_id_scope)
    except (KeyError, ValueError):
        # Missing required keys or invalid UUID/role format
        return None


def clear_session_cookie(response: Response) -> None:
    """Delete the session cookie by setting max_age=0.

    Args:
        response: Starlette Response object to clear the cookie on.
    """
    response.set_cookie(
        key="session",
        value="",
        httponly=True,
        samesite="lax",
        max_age=0,
        path="/",
    )
