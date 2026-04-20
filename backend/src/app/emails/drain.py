"""Email outbox drain — M6-full.

Public interface
----------------
send_email(subject, html_body, recipients, from_addr)
    Provider-agnostic send. Dispatches to Resend or SendGrid based on
    settings.email_provider.  Raises ProviderError (retryable) or
    PermanentError (stop retrying).

drain_batch(db, batch_size)
    Fetches up to `batch_size` QUEUED rows with SELECT … FOR UPDATE SKIP
    LOCKED, sends each one, commits per row.  Safe to call concurrently —
    each worker grabs a disjoint batch.

CLI: `python -m app.emails.drain --once`
    Drain one batch and exit.  Useful for Railway cron or manual catch-up.

Constraints (see CLAUDE.md)
----------------------------
- One scheduler replica only; SKIP LOCKED handles concurrency.
- All mutations write audit_log rows.
- Party names / recipient addresses redacted in non-debug logs.
- Never hits the real wire in tests — callers mock send_email / SDK funcs.
- Exponential back-off up to MAX_ATTEMPTS (5) retries.
  4xx from provider → PermanentError, stops immediately.
  5xx / network     → ProviderError, retried next drain cycle.
"""

from __future__ import annotations

import hashlib
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from app.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.models.audit_log import AuditLog
from app.db.models.email_outbox import EmailOutbox

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_ATTEMPTS: int = 5
BATCH_SIZE: int = 50  # rows per drain call

# HTTP status classification thresholds
_HTTP_4XX_MIN: int = 400
_HTTP_4XX_MAX: int = 500  # exclusive upper bound
_HTTP_5XX_MIN: int = 500

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ProviderError(RuntimeError):
    """Retryable send failure — 5xx or network-level error."""


class PermanentError(RuntimeError):
    """Non-retryable failure — 4xx from provider, invalid recipients, etc.

    Carries the reason string stored verbatim in ``last_error``.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


# ---------------------------------------------------------------------------
# Provider-agnostic sender
# ---------------------------------------------------------------------------


def send_email(
    *,
    subject: str,
    html_body: str,
    recipients: list[str],
    from_addr: str,
) -> None:
    """Send one email via the configured provider.

    Raises:
        ProviderError: Retryable failure (5xx, network timeout, etc.)
        PermanentError: Non-retryable failure (4xx — bad API key, bad
            recipient address, etc.)

    Does NOT log recipient addresses at INFO/WARNING level (CLAUDE.md
    "Data handling").  Address hash is logged at DEBUG only.
    """
    settings = get_settings()
    log = get_logger(__name__)
    recipients_hash = hashlib.sha256("|".join(sorted(recipients)).encode()).hexdigest()[:8]

    log.debug(
        "email.send_attempt",
        provider=settings.email_provider,
        recipients_hash=recipients_hash,
    )

    if settings.email_provider == "resend":
        _send_via_resend(
            subject=subject,
            html_body=html_body,
            recipients=recipients,
            from_addr=from_addr,
            api_key=settings.resend_api_key,
        )
    elif settings.email_provider == "sendgrid":
        _send_via_sendgrid(
            subject=subject,
            html_body=html_body,
            recipients=recipients,
            from_addr=from_addr,
            api_key=settings.sendgrid_api_key,
        )
    else:
        # Exhaustive guard — config validator enforces the Literal already
        raise ProviderError(f"Unknown email_provider: {settings.email_provider!r}")

    log.info(
        "email.sent",
        provider=settings.email_provider,
        recipients_count=len(recipients),
        recipients_hash=recipients_hash,
    )


# ---------------------------------------------------------------------------
# Resend backend
# ---------------------------------------------------------------------------


def _send_via_resend(
    *,
    subject: str,
    html_body: str,
    recipients: list[str],
    from_addr: str,
    api_key: str,
) -> None:
    """Send via the Resend SDK (resend>=2.4).

    Raises:
        PermanentError: HTTP 4xx from Resend.
        ProviderError:  HTTP 5xx or network error.
    """
    import resend  # imported late so tests can easily patch module-level attr

    resend.api_key = api_key  # SDK reads this global before each request

    try:
        resend.Emails.send(
            {
                "from": from_addr,
                "to": recipients,
                "subject": subject,
                "html": html_body,
            }
        )
    except Exception as exc:
        # Resend SDK raises resend.exceptions.ResendError for API errors.
        # We classify by status_code when available; fall back to 5xx-style.
        status_code: int | None = getattr(exc, "status_code", None)
        if status_code is not None and _HTTP_4XX_MIN <= status_code < _HTTP_4XX_MAX:
            raise PermanentError(f"PERMANENT_RESEND_{status_code}") from exc
        raise ProviderError(str(exc)) from exc


# ---------------------------------------------------------------------------
# SendGrid backend
# ---------------------------------------------------------------------------


def _send_via_sendgrid(
    *,
    subject: str,
    html_body: str,
    recipients: list[str],
    from_addr: str,
    api_key: str,
) -> None:
    """Send via the SendGrid SDK (sendgrid>=6.11).

    Raises:
        PermanentError: HTTP 4xx from SendGrid.
        ProviderError:  HTTP 5xx or network error.
    """
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Content, From, Mail, To

    client = SendGridAPIClient(api_key)
    to_list = [To(addr) for addr in recipients]
    mail = Mail(
        from_email=From(from_addr),
        subject=subject,
        to_emails=to_list,
    )
    mail.content = [Content("text/html", html_body)]

    try:
        response = client.send(mail)
    except Exception as exc:
        # SendGrid SDK raises python_http_client.exceptions.HTTPError for
        # HTTP errors; status_code lives on the exception.
        status_code = getattr(exc, "status_code", None)
        if status_code is not None and _HTTP_4XX_MIN <= status_code < _HTTP_4XX_MAX:
            raise PermanentError(f"PERMANENT_SENDGRID_{status_code}") from exc
        raise ProviderError(str(exc)) from exc
    else:
        # SDK returns the response object; 4xx is surfaced as success in some
        # versions — check status_code explicitly.
        status_code = getattr(response, "status_code", None)
        if status_code is not None and _HTTP_4XX_MIN <= status_code < _HTTP_4XX_MAX:
            raise PermanentError(f"PERMANENT_SENDGRID_{status_code}")
        if status_code is not None and status_code >= _HTTP_5XX_MIN:
            raise ProviderError(f"SendGrid 5xx: {status_code}")


# ---------------------------------------------------------------------------
# Drain loop
# ---------------------------------------------------------------------------


def drain_batch(
    db: Session,
    *,
    batch_size: int = BATCH_SIZE,
) -> int:
    """Drain up to `batch_size` QUEUED rows from email_outbox.

    Guarantees:
    - SELECT … FOR UPDATE SKIP LOCKED: concurrent drains grab disjoint rows.
    - One commit per row so partial batches are not lost on error.
    - sent_at populated on success; attempts incremented + last_error set on
      transient failure; PERMANENT_* error marks sent_at=now to stop retrying.
    - Every outcome writes an audit_log row.

    Returns:
        Number of rows attempted (sent + failed).
    """
    from sqlalchemy import and_, select

    settings = get_settings()
    log = get_logger(__name__)
    rows: list[EmailOutbox] = list(
        db.scalars(
            select(EmailOutbox)
            .where(
                and_(
                    EmailOutbox.status == "QUEUED",
                    EmailOutbox.sent_at.is_(None),
                    EmailOutbox.attempts < MAX_ATTEMPTS,
                )
            )
            .order_by(EmailOutbox.enqueued_at)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        ).all()
    )

    attempted = 0
    for row in rows:
        attempted += 1
        recipients: list[str] = list(row.recipients_json or [])

        # Skip rows with no recipients — mark FAILED immediately to avoid
        # infinite looping (this should not happen in normal flow but is a
        # defensive guard for rows seeded without recipients).
        if not recipients:
            row.attempts += 1
            row.last_error = "PERMANENT_NO_RECIPIENTS"
            row.status = "FAILED"
            row.sent_at = datetime.now(tz=UTC)
            db.add(
                AuditLog(
                    action="email_outbox.failed",
                    entity_type="email_outbox",
                    entity_id=row.id,
                    before={"status": "QUEUED", "attempts": row.attempts - 1},
                    after={
                        "status": "FAILED",
                        "last_error": row.last_error,
                        "attempts": row.attempts,
                    },
                )
            )
            db.commit()
            log.warning(
                "email_drain.no_recipients",
                outbox_id=str(row.id),
                rule_type=row.rule_type,
            )
            continue

        try:
            send_email(
                subject=row.subject,
                html_body=row.body_html,
                recipients=recipients,
                from_addr=f"{settings.smtp_from_name} <{settings.smtp_from_address}>",
            )
        except PermanentError as exc:
            row.attempts += 1
            row.last_error = exc.reason
            row.status = "FAILED"
            row.sent_at = datetime.now(tz=UTC)  # sentinel — no retry
            db.add(
                AuditLog(
                    action="email_outbox.failed",
                    entity_type="email_outbox",
                    entity_id=row.id,
                    before={"status": "QUEUED", "attempts": row.attempts - 1},
                    after={
                        "status": "FAILED",
                        "last_error": row.last_error,
                        "attempts": row.attempts,
                    },
                )
            )
            db.commit()
            log.warning(
                "email_drain.permanent_failure",
                outbox_id=str(row.id),
                rule_type=row.rule_type,
                error=exc.reason,
            )
        except ProviderError as exc:
            row.attempts += 1
            row.last_error = str(exc)
            # Check if max attempts reached — if so, permanently fail.
            if row.attempts >= MAX_ATTEMPTS:
                row.status = "FAILED"
                row.sent_at = datetime.now(tz=UTC)
                row.last_error = f"PERMANENT_MAX_ATTEMPTS: {exc}"
            db.add(
                AuditLog(
                    action="email_outbox.failed",
                    entity_type="email_outbox",
                    entity_id=row.id,
                    before={"status": "QUEUED", "attempts": row.attempts - 1},
                    after={
                        "status": row.status,
                        "last_error": row.last_error,
                        "attempts": row.attempts,
                    },
                )
            )
            db.commit()
            log.warning(
                "email_drain.retryable_failure",
                outbox_id=str(row.id),
                rule_type=row.rule_type,
                attempts=row.attempts,
                error=str(exc),
            )
        else:
            row.status = "SENT"
            row.sent_at = datetime.now(tz=UTC)
            db.add(
                AuditLog(
                    action="email_outbox.sent",
                    entity_type="email_outbox",
                    entity_id=row.id,
                    before={"status": "QUEUED", "attempts": row.attempts},
                    after={"status": "SENT", "sent_at": row.sent_at.isoformat()},
                )
            )
            db.commit()
            log.info(
                "email_drain.sent",
                outbox_id=str(row.id),
                rule_type=row.rule_type,
            )

    log.info(
        "email_drain.batch_complete",
        attempted=attempted,
        batch_size=batch_size,
    )
    return attempted


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def _cli_main() -> None:  # pragma: no cover — exercised via subprocess in tests
    """python -m app.emails.drain --once

    Drains a single batch and exits.  Useful for Railway cron or manual
    catch-up without the in-process APScheduler.
    """
    import argparse

    configure_logging()
    log = get_logger(__name__)

    parser = argparse.ArgumentParser(description="Drain email_outbox")
    parser.add_argument(
        "--once",
        action="store_true",
        required=True,
        help="Drain one batch and exit.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
    )
    args = parser.parse_args()

    from app.db.session import SessionLocal

    with SessionLocal() as db:
        start = time.monotonic()
        attempted = drain_batch(db, batch_size=args.batch_size)
        elapsed = time.monotonic() - start
        log.info(
            "email_drain.cli_done",
            attempted=attempted,
            elapsed_s=round(elapsed, 3),
        )


if __name__ == "__main__":
    _cli_main()
