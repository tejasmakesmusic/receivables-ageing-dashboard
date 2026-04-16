"""APScheduler setup — daily CFO digest (spec §8.1, consequences 9–10).

Key constraints (do not violate):
  - Postgres job store (SQLAlchemyJobStore) → survives Railway redeploys
    and avoids double-fire if >1 replica is ever started accidentally.
  - Single cron: UTC 03:30 Mon–Fri = IST 09:00 (spec §11, D18).
  - Never run scheduler on >1 replica without job store locks (CLAUDE.md).

Implementation lands in Milestone 6.
"""

from __future__ import annotations
