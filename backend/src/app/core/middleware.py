"""Starlette middleware — request_id injection + structured access logging + CSRF.

RequestIDMiddleware:
  - Generates a UUID4 request_id per request
  - Binds it to structlog contextvars so every log entry in the request carries it
  - Adds X-Request-ID response header
  - Logs request.start (method, path) and request.end (method, path, status, duration_ms)
  - Clears contextvars after each request (essential — ASGI workers are reused)

CSRFMiddleware:
  - Double-submit cookie pattern for /admin/* POST/PUT/PATCH/DELETE
  - Sets csrf_token cookie on every response
  - Validates form body csrf_token matches cookie value for state-changing methods
  - Exempt: /auth/ prefix (OAuth callback) and /health
"""

from __future__ import annotations

import secrets
import time
import urllib.parse as _urlparse
import uuid
from typing import TYPE_CHECKING

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from app.core.logging import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request

log = get_logger(__name__)


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = str(uuid.uuid4())
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        log.info("request.start", method=request.method, path=request.url.path)
        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            log.info(
                "request.end",
                method=request.method,
                path=request.url.path,
                status=response.status_code if response is not None else None,
                duration_ms=duration_ms,
            )
            if response is not None:
                response.headers["X-Request-ID"] = request_id
            structlog.contextvars.clear_contextvars()


class CSRFMiddleware(BaseHTTPMiddleware):
    _SAFE_METHODS: frozenset[str] = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
    _EXEMPT_PREFIXES: tuple[str, ...] = ("/auth/",)  # prefix match
    _EXEMPT_EXACT: frozenset[str] = frozenset({"/health"})  # exact match

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        from app.config import get_settings

        settings = get_settings()

        cookie_token = request.cookies.get("csrf_token")
        token = cookie_token or secrets.token_hex(32)

        if (
            request.method not in self._SAFE_METHODS
            and request.url.path not in self._EXEMPT_EXACT
            and not any(request.url.path.startswith(p) for p in self._EXEMPT_PREFIXES)
        ):
            # Extract csrf_token based on content type.
            # BaseHTTPMiddleware caches request.body() so the endpoint still
            # sees the full body after this read.
            content_type = request.headers.get("content-type", "")
            if "application/x-www-form-urlencoded" in content_type:
                body_bytes = await request.body()
                form_params = dict(
                    _urlparse.parse_qsl(body_bytes.decode("utf-8", errors="replace"))
                )
                form_token = form_params.get("csrf_token", "")
            elif "multipart/form-data" in content_type:
                # File upload: read CSRF token from X-CSRF-Token header instead of body
                form_token = request.headers.get("X-CSRF-Token", "")
            else:
                # JSON and other content types: read CSRF token from X-CSRF-Token header.
                # This covers PATCH/DELETE with application/json bodies.
                form_token = request.headers.get("X-CSRF-Token", "")

            if not cookie_token or not secrets.compare_digest(cookie_token, str(form_token)):
                return Response("CSRF validation failed", status_code=403)

        response = await call_next(request)

        # Set / refresh CSRF cookie on every response
        response.set_cookie(
            key="csrf_token",
            value=token,
            httponly=False,
            secure=settings.session_cookie_secure,
            samesite="lax",
            path="/",
        )
        return response
