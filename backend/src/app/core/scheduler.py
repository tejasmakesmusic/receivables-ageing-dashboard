"""APScheduler setup — daily CFO digest (spec §8.1) + email drain (M6-full).

Key constraints (do not violate):
  - Postgres job store (SQLAlchemyJobStore) -> survives Railway redeploys
    and avoids double-fire if >1 replica is ever started accidentally.
  - Single worker thread pool (max_workers=1) so jobs run serially, never
    concurrently on this process.
  - Email drain also uses SELECT ... FOR UPDATE SKIP LOCKED so multiple
    processes cannot double-send even if two replicas are up (CLAUDE.md).
  - Never run scheduler on >1 replica without Postgres job store locks.

Scheduler lifecycle
-------------------
Call `start_scheduler()` from the FastAPI lifespan context manager on startup
and `shutdown_scheduler()` on shutdown.  Both are idempotent.

Email drain interval
--------------------
Configurable via DRAIN_INTERVAL_SECONDS env var (default 60).  Set to 0 to
disable the in-process drain entirely (for Railway cron-only deployments).
"""

from __future__ import annotations

import os

from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)

# Module-level singleton -- initialised lazily in start_scheduler().
_scheduler: BackgroundScheduler | None = None


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def _run_email_drain() -> None:
    """APScheduler job: drain one batch from email_outbox.

    Creates its own DB session so the job is independent of FastAPI's
    request-scoped session lifecycle.
    """
    from app.db.session import SessionLocal
    from app.emails.drain import drain_batch

    with SessionLocal() as session:
        try:
            attempted = drain_batch(session)
            log.debug("scheduler.email_drain_job", attempted=attempted)
        except Exception:
            log.exception("scheduler.email_drain_job_failed")


def _run_daily_digest() -> None:
    """APScheduler job: CFO daily digest (spec §8.1, M6-full).

    Enqueues DAILY_DIGEST rows into email_outbox for each entity (IND, UAE).
    Creates its own DB session, independent of FastAPI request lifecycle.
    """
    from app.db.session import SessionLocal
    from app.services.digest_service import run_daily_digest

    log.info("scheduler.daily_digest_job.start")
    with SessionLocal() as session:
        try:
            rows = run_daily_digest(session)
            log.info("scheduler.daily_digest_job.done", enqueued_count=len(rows))
        except Exception:
            log.exception("scheduler.daily_digest_job_failed")


def _run_weekly_default_cp_nudge() -> None:
    """APScheduler job: weekly analyst nudge for parties on default CP (spec §13 #5).

    Enqueues WEEKLY_DEFAULT_CP_NUDGE rows into email_outbox for each entity
    (IND, UAE) every Monday 09:00 IST.  Idempotent — skips if a nudge for
    the current ISO week already exists in email_outbox.
    Creates its own DB session, independent of FastAPI request lifecycle.
    """
    from app.db.session import SessionLocal
    from app.services.default_cp_nudge_service import run_weekly_default_cp_nudge

    log.info("scheduler.weekly_default_cp_nudge_job.start")
    with SessionLocal() as session:
        try:
            rows = run_weekly_default_cp_nudge(session)
            log.info(
                "scheduler.weekly_default_cp_nudge_job.done",
                enqueued_count=len(rows),
            )
        except Exception:
            log.exception("scheduler.weekly_default_cp_nudge_job_failed")


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------


def start_scheduler() -> None:
    """Initialise and start the background scheduler.

    Idempotent -- safe to call multiple times (subsequent calls are no-ops).
    """
    global _scheduler  # noqa: PLW0603

    settings = get_settings()

    if _scheduler is not None and _scheduler.running:
        log.debug("scheduler.already_running")
        return

    drain_interval_seconds = int(os.environ.get("DRAIN_INTERVAL_SECONDS", "60"))

    # Use direct (non-pooled) DSN for the job store -- pgbouncer (pooled) does
    # not support the advisory-lock queries APScheduler emits.
    db_url = settings.database_url_direct or settings.database_url
    if not db_url:
        log.warning("scheduler.no_db_url_skipping")
        return

    # Normalise DSN (psycopg3 driver).
    if db_url.startswith("postgresql://"):
        db_url = "postgresql+psycopg://" + db_url[len("postgresql://") :]
    elif db_url.startswith("postgres://"):
        db_url = "postgresql+psycopg://" + db_url[len("postgres://") :]

    try:
        jobstores = {
            "default": SQLAlchemyJobStore(url=db_url, tablename="apscheduler_jobs"),
        }
    except Exception:
        log.exception("scheduler.jobstore_init_failed")
        return

    executors = {
        # Single worker -- jobs run serially; no risk of overlapping drain runs.
        "default": ThreadPoolExecutor(max_workers=1),
    }

    _scheduler = BackgroundScheduler(
        jobstores=jobstores,
        executors=executors,
        timezone=settings.scheduler_timezone,
        job_defaults={
            "coalesce": True,  # run only the most recent missed trigger
            "max_instances": 1,  # never overlap with itself
            "misfire_grace_time": 60,
        },
    )

    # --- Email drain ---
    if drain_interval_seconds > 0:
        _scheduler.add_job(
            _run_email_drain,
            trigger=IntervalTrigger(seconds=drain_interval_seconds),
            id="email_drain",
            name="Email outbox drain",
            replace_existing=True,
        )
        log.info(
            "scheduler.email_drain_registered",
            interval_seconds=drain_interval_seconds,
        )

    # --- Daily CFO digest (M6-full) ---
    # D18: CronTrigger MUST use Asia/Kolkata so the fire time tracks IST,
    # not a fixed UTC offset.  digest_hour_ist / digest_minute_ist default
    # to 9:00, giving 09:00 IST (approx 03:30 UTC).
    digest_hour = getattr(settings, "digest_hour_ist", 9)
    digest_minute = getattr(settings, "digest_minute_ist", 0)
    _scheduler.add_job(
        _run_daily_digest,
        trigger=CronTrigger(
            hour=digest_hour,
            minute=digest_minute,
            timezone="Asia/Kolkata",
        ),
        id="daily_digest",
        name="CFO daily digest (IST)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info(
        "scheduler.daily_digest_registered",
        schedule=f"{digest_hour:02d}:{digest_minute:02d} IST (Asia/Kolkata)",
    )

    # --- Weekly default-CP analyst nudge (spec §13 #5) ---
    # Every Monday 09:00 IST.  CronTrigger with Asia/Kolkata tracks IST
    # (including DST-equivalent offsets) — never a fixed UTC offset.
    _scheduler.add_job(
        _run_weekly_default_cp_nudge,
        trigger=CronTrigger(
            day_of_week="mon",
            hour=9,
            minute=0,
            timezone="Asia/Kolkata",
        ),
        id="weekly_default_cp_nudge",
        name="Weekly default-CP analyst nudge (IST)",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    log.info(
        "scheduler.weekly_default_cp_nudge_registered",
        schedule="Monday 09:00 IST (Asia/Kolkata)",
    )

    try:
        _scheduler.start()
        log.info("scheduler.started")
    except Exception:
        log.exception("scheduler.start_failed")
        _scheduler = None


def shutdown_scheduler() -> None:
    """Gracefully stop the scheduler.  Idempotent."""
    global _scheduler  # noqa: PLW0603

    if _scheduler is None or not _scheduler.running:
        return

    try:
        _scheduler.shutdown(wait=False)
        log.info("scheduler.stopped")
    except Exception:
        log.exception("scheduler.shutdown_error")
    finally:
        _scheduler = None
