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
from typing import TYPE_CHECKING
from urllib.parse import urlparse, urlunparse

import httpx

if TYPE_CHECKING:
    from collections.abc import Iterator


NEON_API = "https://console.neon.tech/api/v2"

# Poll up to 60 s (doubled from plan's 30 s) with 2-second intervals.
# Free-tier Neon branches occasionally take 30-45 s to become active.
_POLL_MAX = 60
_POLL_INTERVAL = 2


@contextmanager
def neon_branch_dsn() -> Iterator[str]:
    api_key = os.getenv("NEON_API_KEY")
    project_id = os.getenv("NEON_PROJECT_ID")
    parent_id = os.getenv("NEON_PARENT_BRANCH_ID")

    if not (api_key and project_id and parent_id):
        # Fallback: use the configured direct DSN (no per-session isolation, but runs).
        direct = os.environ["DATABASE_URL_DIRECT"]
        yield direct
        return

    headers = {"Authorization": f"Bearer {api_key}"}
    name = f"test-{uuid.uuid4().hex[:8]}"

    # Create branch + endpoint in one call
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
    endpoint_host = data["endpoints"][0]["host"]

    # Wait for endpoint to be ready (up to _POLL_MAX seconds)
    elapsed = 0
    while elapsed < _POLL_MAX:
        r = httpx.get(
            f"{NEON_API}/projects/{project_id}/endpoints",
            headers=headers,
            timeout=10,
        )
        r.raise_for_status()
        eps = r.json()["endpoints"]
        if any(e["host"] == endpoint_host and e["current_state"] == "active" for e in eps):
            break
        time.sleep(_POLL_INTERVAL)
        elapsed += _POLL_INTERVAL

    # Build DSN by swapping the host in the parent's direct DSN.
    # Parent DSN shape: postgresql+psycopg://user:pass@ep-xxx.region.aws.neon.tech/db?...
    parent_dsn = os.environ["DATABASE_URL_DIRECT"]
    p = urlparse(parent_dsn)
    # Preserve credentials (user:pass@) from parent; swap only the host portion.
    userinfo = p.netloc.split("@")[0]  # "user:pass"
    new_netloc = userinfo + "@" + endpoint_host
    dsn = urlunparse(p._replace(netloc=new_netloc))

    try:
        yield dsn
    finally:
        httpx.delete(
            f"{NEON_API}/projects/{project_id}/branches/{branch_id}",
            headers=headers,
            timeout=30,
        )
