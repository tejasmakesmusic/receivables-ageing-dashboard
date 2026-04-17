"""Database layer — SQLAlchemy 2.x engine, session factory, declarative base.

Importing this package registers app-layer SQLAlchemy event hooks (e.g. the
D15 fx_rates immutability guard). Consumers — tests, CLI scripts, the FastAPI
app, Alembic env — always import from `app.db.*` to get a DB session, which
ensures the hooks are active everywhere a Session exists.
"""

from __future__ import annotations

# D15: load the fx_rates immutability hook at package import time.
# Keeping the registration here (rather than only in app/main.py) means
# integration tests, CLI scripts, and any other DB consumer get the
# guard automatically, closing the gap between model definition (Task 5)
# and app wiring (Task 12).
from app.db import events as _events  # noqa: F401
