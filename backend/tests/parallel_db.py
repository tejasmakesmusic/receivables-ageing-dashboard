"""Per-thread engine factory for concurrency tests.

Provides independent SQLAlchemy Engine + Session instances that each operate on
their own real Postgres connection with AUTOCOMMIT-style transaction management.
This allows concurrent tests to exercise actual row-level locks (SELECT FOR UPDATE)
without the nested-transaction-rollback trick used by the standard `db_session`
fixture, which would collapse all flushes into a single connection and prevent
cross-thread lock contention.

Usage in a test::

    from tests.parallel_db import make_thread_session, cleanup_thread_sessions

    def test_something(test_engine):
        factory = ThreadSessionFactory(test_engine)
        session = factory.make()
        try:
            # ... use session, commit as needed ...
            session.commit()
        finally:
            factory.close_all()

Design notes:
- Each call to ``ThreadSessionFactory.make()`` creates a **fresh** Engine connection
  and a Session bound to it.  The engine itself is shared (connection pool is NOT
  shared — we use ``poolclass=NullPool`` per session to guarantee isolation).
- Uses ``NullPool`` so each session has a dedicated connection that is not returned
  to any shared pool.  This prevents lock-wait starvation between threads using the
  same pool.
- Session is created with ``expire_on_commit=False`` so attribute access after
  commit does not trigger unexpected lazy loads.
- ``cleanup()`` rolls back any uncommitted work, closes the session, and disposes
  the engine.  Always call it in a ``finally`` block.  Raises are suppressed (each
  resource is cleaned up independently) to ensure all connections are returned to
  Postgres even if one teardown step fails.
- This module does NOT delete test data — the caller is responsible for seeding
  data with unique identifiers (e.g. UUIDs generated inside the test) and deleting
  it in a ``try/finally`` block so that real COMMITs don't leak rows into subsequent
  tests.  See ``test_concurrent_publish_serialised_via_row_lock`` for the pattern.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

if TYPE_CHECKING:
    from sqlalchemy.engine import Engine


class ThreadSession:
    """A dedicated engine + session pair for one thread."""

    def __init__(self, dsn: str) -> None:
        # NullPool: no connection is returned to a pool — the connection is closed
        # when session.close() / engine.dispose() is called.  This is deliberate:
        # concurrent lock tests must not accidentally share a pooled connection.
        self._engine: Engine = create_engine(
            dsn,
            poolclass=NullPool,
            pool_pre_ping=True,
            future=True,
        )
        session_factory = sessionmaker(bind=self._engine, expire_on_commit=False)
        self.session: Session = session_factory()

    def cleanup(self) -> None:
        """Roll back any uncommitted transaction, close session, dispose engine.

        Swallows individual exceptions so that all three cleanup steps always run.
        """
        for step, fn in [
            ("rollback", self.session.rollback),
            ("close_session", self.session.close),
            ("dispose_engine", self._engine.dispose),
        ]:
            try:
                fn()
            except Exception as exc:
                import sys

                sys.stderr.write(f"WARN parallel_db cleanup step={step} error={exc!r}\n")


class ThreadSessionFactory:
    """Factory that tracks all ThreadSession instances for bulk cleanup."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._lock = threading.Lock()
        self._sessions: list[ThreadSession] = []

    def make(self) -> Session:
        """Return a fresh Session bound to a dedicated NullPool engine.

        The underlying ``ThreadSession`` is registered internally so
        ``close_all()`` can tear it down.
        """
        ts = ThreadSession(self._dsn)
        with self._lock:
            self._sessions.append(ts)
        return ts.session

    def close_all(self) -> None:
        """Cleanup all sessions created by this factory."""
        with self._lock:
            sessions = list(self._sessions)
        for ts in sessions:
            ts.cleanup()
