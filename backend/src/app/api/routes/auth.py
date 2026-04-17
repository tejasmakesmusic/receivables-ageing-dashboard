"""Google OAuth authentication routes (spec D4 + §11).

Routes (all mounted under /auth via include_router prefix):
  GET /google/login   — redirect to Google consent screen or stub shortcut
  GET /google/callback — exchange code, upsert user, issue session cookie
  GET /logout         — clear session cookie, redirect to /
  GET /error          — fallback HTML error page (real UI in M3)
  GET /pending        — pending approval page (spec §13)
  GET /me             — current user info endpoint (spec §10)

Stub mode (auth_provider="stub") bypasses real OAuth for local dev + tests.
"""

from __future__ import annotations

import base64
import hashlib
import html as html_lib
import json
import secrets
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import (
    Session,  # noqa: TCH002 — needed at runtime for Annotated[Session, Depends(...)]
)

from app.api.deps import db_session, get_current_user
from app.config import get_settings

if TYPE_CHECKING:
    from app.config import Settings
from app.core.logging import get_logger
from app.core.rbac import Role
from app.core.session import SessionData, clear_session_cookie, create_session_cookie
from app.db.models.audit_log import AuditLog
from app.db.models.user import User

log = get_logger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _exchange_code(code: str, settings: Settings) -> dict[str, Any]:
    """POST to Google's token endpoint, return the JSON payload."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_oauth_client_id,
                "client_secret": settings.google_oauth_client_secret,
                "redirect_uri": settings.google_oauth_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        payload: dict[str, Any] = resp.json()
        return payload


def _decode_id_token_payload(id_token: str) -> dict[str, Any]:
    """Decode JWT payload without signature verification (M1 only).

    TODO(M2): verify signature against Google's public JWKS endpoint
    (https://www.googleapis.com/oauth2/v3/certs) before trusting any claims.
    This is acceptable for M1 because:
    - The token arrives over TLS on Railway.
    - The preceding Google OAuth code-exchange is the real trust boundary.
    - We additionally verify the `hd` (hosted domain) claim below.
    """
    parts = id_token.split(".")
    jwt_min_parts = 2
    if len(parts) < jwt_min_parts:
        raise ValueError("Malformed id_token: expected at least 2 segments")
    # JWT base64url segments are un-padded — re-pad to a multiple of 4
    payload_b64 = parts[1] + "=="
    payload_bytes = base64.urlsafe_b64decode(payload_b64)
    return json.loads(payload_bytes)  # type: ignore[no-any-return]


def _upsert_user(
    session: Session,
    *,
    email: str,
    name: str | None,
    google_sub: str | None,
) -> User:
    """Look up or create a User row and write an audit_log entry.

    Args:
        session: Open SQLAlchemy session (caller commits).
        email: Normalized (lowercase) email address.
        name: Display name from Google (may be None for stub path).
        google_sub: Google subject identifier (None for stub path).

    Returns:
        The persisted User ORM object.
    """
    existing: User | None = (
        session.query(User).filter(func.lower(User.email) == email.lower()).first()
    )

    now = datetime.now(UTC)

    if existing is None:
        user = User(
            id=uuid.uuid4(),
            email=email.lower(),
            name=name,
            role=Role.PENDING,
            is_active=True,
            google_sub=google_sub,
            entity_id_scope=None,
            last_login_at=now,
        )
        session.add(user)
        session.flush()  # populate user.id before writing audit log
        log.info(
            "auth.user_created", email_hash=hashlib.sha256(email.lower().encode()).hexdigest()[:16]
        )
    else:
        user = existing
        if google_sub and not user.google_sub:
            user.google_sub = google_sub
        if name and name != user.name:
            user.name = name
        user.last_login_at = now
        log.info(
            "auth.user_login", email_hash=hashlib.sha256(email.lower().encode()).hexdigest()[:16]
        )

    audit = AuditLog(
        id=uuid.uuid4(),
        actor_user_id=user.id,
        action="user_login",
        entity_type="users",
        entity_id=user.id,
        before=None,
        after={"email": user.email, "role": user.role.value},
    )
    session.add(audit)
    return user


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/google/login")
def google_login() -> RedirectResponse:
    """Redirect to Google's OAuth consent screen (or stub shortcut in dev)."""
    settings = get_settings()

    if settings.auth_provider == "stub":
        stub_email = "stub@emb.global"
        redirect_url = f"/auth/google/callback?stub_email={stub_email}"
        log.debug("auth.stub_login_redirect", stub_email=stub_email)
        return RedirectResponse(url=redirect_url, status_code=302)

    # --- real Google OAuth path ---
    state = secrets.token_urlsafe(32)

    google_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(
        {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": settings.google_oauth_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "hd": settings.google_oauth_allowed_domain,
            "state": state,
        }
    )

    response = RedirectResponse(url=google_url, status_code=302)
    response.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        secure=settings.session_cookie_secure,  # match session cookie secure flag
        max_age=300,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/google/callback")
async def google_callback(  # noqa: PLR0911
    request: Request,
    session: Annotated[Session, Depends(db_session)],
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    stub_email: str | None = Query(default=None),
) -> RedirectResponse:
    """Handle OAuth callback: verify state, exchange code, upsert user, issue session."""
    settings = get_settings()
    # --- resolve email / name / sub from provider ---
    if settings.auth_provider == "stub":
        if not stub_email:
            log.warning("auth.stub_callback_missing_email")
            return RedirectResponse(url="/auth/error?reason=stub_missing_email", status_code=302)
        email = stub_email.lower()
        name: str | None = "Stub User"
        google_sub: str | None = None

    else:
        # --- real Google path ---
        # 1. Verify CSRF state
        cookie_state = request.cookies.get("oauth_state")
        if not state or not cookie_state or state != cookie_state:
            log.warning("auth.state_mismatch")
            return RedirectResponse(url="/auth/error?reason=state_mismatch", status_code=302)

        # 2. Exchange authorization code for tokens
        if not code:
            log.warning("auth.callback_missing_code")
            return RedirectResponse(url="/auth/error?reason=missing_code", status_code=302)

        try:
            token_response = await _exchange_code(code, settings)
        except httpx.HTTPStatusError as exc:
            log.error("auth.token_exchange_failed", status=exc.response.status_code)
            return RedirectResponse(url="/auth/error?reason=token_exchange_failed", status_code=302)
        except (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError) as exc:
            log.error("auth.token_exchange_network_error", error=type(exc).__name__)
            return RedirectResponse(url="/auth/error?reason=token_exchange_failed", status_code=302)

        id_token = token_response.get("id_token", "")
        if not id_token:
            log.error("auth.missing_id_token")
            return RedirectResponse(url="/auth/error?reason=missing_id_token", status_code=302)

        # 3. Decode id_token payload (no sig verification in M1 — see helper docstring)
        try:
            claims = _decode_id_token_payload(id_token)
        except (ValueError, json.JSONDecodeError) as exc:
            log.error("auth.id_token_decode_failed", error=type(exc).__name__)
            return RedirectResponse(
                url="/auth/error?reason=id_token_decode_failed", status_code=302
            )

        # 4. Verify hosted domain claim
        hd_claim = claims.get("hd", "")
        if hd_claim != settings.google_oauth_allowed_domain:
            log.warning("auth.hd_claim_mismatch", hd=hd_claim)
            return RedirectResponse(url="/auth/error?reason=domain_restricted", status_code=302)

        email = claims.get("email", "").lower()
        name = claims.get("name")
        google_sub = claims.get("sub")

    # --- domain restriction (both stub and google paths) ---
    allowed_domain = settings.google_oauth_allowed_domain
    if not email.endswith(f"@{allowed_domain}"):
        log.warning("auth.domain_restricted", allowed_domain=allowed_domain)
        return RedirectResponse(url="/auth/error?reason=domain_restricted", status_code=302)

    # --- upsert user + audit log ---
    user = _upsert_user(session, email=email, name=name, google_sub=google_sub)
    # Commit before issuing the session cookie. create_session_cookie() calls
    # itsdangerous.dumps() (infallible) + response.set_cookie() (pure mutation),
    # so there is no risk of a partial-commit / no-cookie state in practice.
    session.commit()

    # --- determine redirect destination before constructing response ---
    redirect_url = "/auth/pending" if user.role == Role.PENDING else "/"
    response = RedirectResponse(url=redirect_url, status_code=302)

    # --- issue session cookie ---
    create_session_cookie(
        SessionData(
            user_id=user.id,
            role=user.role,
            entity_id_scope=user.entity_id_scope,
        ),
        response,
    )

    # --- clear oauth_state cookie if it was set ---
    response.delete_cookie(key="oauth_state", path="/")

    return response


@router.get("/logout")
def logout() -> RedirectResponse:
    """Clear the session cookie and redirect to /."""
    response = RedirectResponse(url="/", status_code=302)
    clear_session_cookie(response)
    return response


@router.get("/error", response_class=HTMLResponse)
def auth_error(reason: str = Query(default="unknown")) -> HTMLResponse:
    """Fallback error page — real error UI ships in M3."""
    # Escape reason to prevent reflected XSS (basic defence for M1)
    safe_reason = reason.replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    html = f"<h1>Authentication Error</h1><p>Reason: {safe_reason}</p>"
    return HTMLResponse(content=html, status_code=200)


@router.get("/pending", response_model=None)
def pending(
    user: Annotated[User, Depends(get_current_user)],
) -> HTMLResponse | RedirectResponse:
    """Pending approval page — show if user role is PENDING, otherwise redirect to /.

    Args:
        user: Current authenticated user (raises 401 if not logged in).

    Returns:
        HTMLResponse with pending message if user role is PENDING.
        RedirectResponse to / if user has been promoted to a different role.
    """
    # If user has already been promoted, redirect to dashboard
    if user.role != Role.PENDING:
        return RedirectResponse(url="/", status_code=302)

    # Show pending approval page with user's email.
    # html_lib.escape() prevents reflected XSS — email is DB-sourced but was
    # originally user-supplied via Google, so defensively escape it.
    safe_email = html_lib.escape(user.email)
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Awaiting Approval — EMB Receivables</title></head>
<body>
  <h1>Account pending approval</h1>
  <p>Your <strong>{safe_email}</strong> account has been registered and is awaiting
  admin approval. You will be notified by email once approved.</p>
  <p><a href="/auth/logout">Sign out</a></p>
</body>
</html>"""
    return HTMLResponse(content=html_content, status_code=200)


@router.get("/me")
def current_user_info(
    user: Annotated[User, Depends(get_current_user)],
) -> dict[str, str | None]:
    """Get current user info (session check endpoint).

    Args:
        user: Current authenticated user (raises 401 if not logged in).

    Returns:
        JSON dict with user id, email, name, role, and entity_id_scope.
        PENDING role users can call this endpoint.
    """
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role.value,
        "entity_id_scope": str(user.entity_id_scope) if user.entity_id_scope else None,
    }
