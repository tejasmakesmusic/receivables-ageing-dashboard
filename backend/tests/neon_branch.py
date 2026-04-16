"""Neon branch lifecycle helper for test isolation.

Creates a throwaway branch per test session, yields its DSN, deletes it
on teardown.

Fallback: if any of NEON_API_KEY / NEON_PROJECT_ID / NEON_PARENT_BRANCH_ID
is unset, we would yield DATABASE_URL_DIRECT unchanged. Because that DSN
typically points at the shared (main) database, running `alembic upgrade
head` against it is destructive. The fallback therefore refuses to run
unless `TEST_ALLOW_SHARED_DB=1` is explicitly set — fail-closed protects
a CI that forgets to set Neon creds from silently migrating production.
"""

from __future__ import annotations

import os
import sys
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
        # Fail-closed: the fallback runs against whatever DATABASE_URL_DIRECT
        # points at, which is typically the shared `main` branch. Refusing to
        # proceed without an explicit opt-in prevents a CI with stripped
        # secrets from running destructive DDL against production.
        if os.getenv("TEST_ALLOW_SHARED_DB") != "1":
            raise RuntimeError(
                "Neon branching credentials missing "
                "(NEON_API_KEY / NEON_PROJECT_ID / NEON_PARENT_BRANCH_ID), "
                "and TEST_ALLOW_SHARED_DB=1 is not set. Refusing to run tests "
                "against the shared DATABASE_URL_DIRECT target. Either set "
                "the Neon vars or export TEST_ALLOW_SHARED_DB=1 to "
                "acknowledge that tests will mutate the shared DB."
            )
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

    # From this point on, a real branch exists in Neon. ANY exception before
    # cleanup would leak it, so every subsequent step — endpoint unpacking,
    # polling, DSN build, the yield — runs inside try/finally.
    try:
        endpoint_host = data["endpoints"][0]["host"]

        # Wait for endpoint to be ready. Raise TimeoutError (rather than
        # falling through silently) if it never becomes active — otherwise
        # a slow provision would surface as a cryptic psycopg connection
        # error instead of "endpoint never came up".
        elapsed = 0
        endpoint_active = False
        while elapsed < _POLL_MAX:
            r = httpx.get(
                f"{NEON_API}/projects/{project_id}/endpoints",
                headers=headers,
                timeout=10,
            )
            r.raise_for_status()
            eps = r.json()["endpoints"]
            if any(e["host"] == endpoint_host and e["current_state"] == "active" for e in eps):
                endpoint_active = True
                break
            time.sleep(_POLL_INTERVAL)
            elapsed += _POLL_INTERVAL

        if not endpoint_active:
            raise TimeoutError(
                f"Neon endpoint {endpoint_host} for branch {branch_id} did "
                f"not become active within {_POLL_MAX}s."
            )

        # Build DSN by swapping the host in the parent's direct DSN.
        # Parent DSN shape: postgresql+psycopg://user:pass@ep-xxx.region.aws.neon.tech/db?...
        parent_dsn = os.environ["DATABASE_URL_DIRECT"]
        p = urlparse(parent_dsn)
        # Preserve credentials (user:pass@) from parent; swap only host.
        userinfo = p.netloc.split("@")[0]  # "user:pass"
        new_netloc = userinfo + "@" + endpoint_host
        dsn = urlunparse(p._replace(netloc=new_netloc))

        yield dsn
    finally:
        # Cleanup must never mask a test failure. A leaked branch is visible
        # in the Neon console and costs effectively nothing (copy-on-write,
        # auto-suspends). A masked pytest error would hide a real regression
        # — much worse. So log and swallow delete failures.
        try:
            httpx.delete(
                f"{NEON_API}/projects/{project_id}/branches/{branch_id}",
                headers=headers,
                timeout=30,
            )
        except Exception as e:
            sys.stderr.write(f"WARN: failed to delete Neon branch {branch_id}: {e!r}\n")
