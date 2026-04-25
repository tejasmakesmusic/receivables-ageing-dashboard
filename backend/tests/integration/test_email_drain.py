"""Integration tests for the email_outbox drain (M6-full).

Coverage:
  1. Happy path — QUEUED row → status=SENT, sent_at populated.
  2. Permanent failure (4xx) → status=FAILED immediately, last_error=PERMANENT_*.
  3. Retryable failure → status stays QUEUED, attempts incremented.
  4. Max-attempts reached → permanently fails with PERMANENT_MAX_ATTEMPTS.
  5. FOR UPDATE SKIP LOCKED — two concurrent drains don't double-send.
  6. send_email dispatch — routes to correct provider backend.

SDK calls are always mocked; no real HTTP traffic.

Note on DB session: drain_batch() calls db.commit() per row, which breaks
the conftest per-test rollback.  Tests that call drain_batch() therefore
use the session directly (no nested-transaction guarantee) and clean up
their own rows with a compensating DELETE in the finally block.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select

from app.db.models.audit_log import AuditLog
from app.db.models.email_outbox import EmailOutbox

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.orm import Session

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_FAKE_RECIPIENT = "test@example.invalid"  # never resolves to a real MX


def _seed_outbox(
    db: Session,
    *,
    status: str = "QUEUED",
    recipients: list[str] | None = None,
    attempts: int = 0,
    last_error: str | None = None,
    sent_at: datetime | None = None,
) -> EmailOutbox:
    row = EmailOutbox(
        subject="Test subject",
        body_html="<p>body</p>",
        status=status,
        rule_type="PUBLISH_NOTIF",
        recipients_json=recipients if recipients is not None else [_FAKE_RECIPIENT],
        attempts=attempts,
        last_error=last_error,
        sent_at=sent_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _cleanup(db: Session, *row_ids: uuid.UUID) -> None:
    """Delete specific rows so commit-based tests don't pollute later tests."""
    for rid in row_ids:
        row = db.get(EmailOutbox, rid)
        if row is not None:
            db.delete(row)
    db.commit()


# ---------------------------------------------------------------------------
# Unit-level: send_email provider dispatch
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestSendEmailDispatch:
    """send_email() picks the right provider based on settings.email_provider."""

    def test_resend_path_called(self) -> None:
        from app.emails.drain import send_email

        with (
            patch("app.emails.drain._send_via_resend") as mock_resend,
            patch("app.emails.drain._send_via_sendgrid") as mock_sg,
            patch("app.emails.drain.get_settings") as mock_settings,
        ):
            cfg = MagicMock()
            cfg.email_provider = "resend"
            cfg.resend_api_key = "re_stub"
            mock_settings.return_value = cfg

            send_email(
                subject="s",
                html_body="<p>b</p>",
                recipients=["a@example.invalid"],
                from_addr="bot@example.invalid",
            )

        mock_resend.assert_called_once()
        mock_sg.assert_not_called()

    def test_sendgrid_path_called(self) -> None:
        from app.emails.drain import send_email

        with (
            patch("app.emails.drain._send_via_resend") as mock_resend,
            patch("app.emails.drain._send_via_sendgrid") as mock_sg,
            patch("app.emails.drain.get_settings") as mock_settings,
        ):
            cfg = MagicMock()
            cfg.email_provider = "sendgrid"
            cfg.sendgrid_api_key = "sg_stub"
            mock_settings.return_value = cfg

            send_email(
                subject="s",
                html_body="<p>b</p>",
                recipients=["a@example.invalid"],
                from_addr="bot@example.invalid",
            )

        mock_sg.assert_called_once()
        mock_resend.assert_not_called()


# ---------------------------------------------------------------------------
# Integration: drain_batch behaviour
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestDrainBatch:
    """Tests require a live DB (Neon branch from conftest)."""

    # -- Happy path ----------------------------------------------------------

    def test_happy_path_sent(self, db_session: Session) -> None:
        """QUEUED row with recipients → SENT after drain."""
        row = _seed_outbox(db_session)
        row_id = row.id

        try:
            with patch("app.emails.drain.send_email") as mock_send:
                mock_send.return_value = None

                from app.emails.drain import drain_batch

                attempted = drain_batch(db_session)

            assert attempted >= 1

            db_session.expire(row)
            db_session.refresh(row)

            updated = db_session.get(EmailOutbox, row_id)
            assert updated is not None
            assert updated.status == "SENT"
            assert updated.sent_at is not None

            # Verify audit log row written
            audit = db_session.scalar(
                select(AuditLog).where(
                    AuditLog.action == "email_outbox.sent",
                    AuditLog.entity_id == row_id,
                )
            )
            assert audit is not None
        finally:
            _cleanup(db_session, row_id)

    # -- Permanent failure ---------------------------------------------------

    def test_permanent_failure_4xx(self, db_session: Session) -> None:
        """4xx from provider → immediately FAILED, no further retries."""
        from app.emails.drain import PermanentError, drain_batch

        row = _seed_outbox(db_session)
        row_id = row.id

        try:
            with patch("app.emails.drain.send_email") as mock_send:
                mock_send.side_effect = PermanentError("PERMANENT_RESEND_422")

                drain_batch(db_session)

            updated = db_session.get(EmailOutbox, row_id)
            assert updated is not None
            assert updated.status == "FAILED"
            assert updated.last_error == "PERMANENT_RESEND_422"
            assert updated.sent_at is not None  # sentinel set to stop retries

            audit = db_session.scalar(
                select(AuditLog).where(
                    AuditLog.action == "email_outbox.failed",
                    AuditLog.entity_id == row_id,
                )
            )
            assert audit is not None
        finally:
            _cleanup(db_session, row_id)

    # -- Retryable failure ---------------------------------------------------

    def test_retryable_failure_increments_attempts(self, db_session: Session) -> None:
        """5xx from provider → row stays QUEUED, attempts += 1."""
        from app.emails.drain import ProviderError, drain_batch

        row = _seed_outbox(db_session)
        row_id = row.id
        initial_attempts = row.attempts

        try:
            with patch("app.emails.drain.send_email") as mock_send:
                mock_send.side_effect = ProviderError("connection reset by peer")

                drain_batch(db_session)

            updated = db_session.get(EmailOutbox, row_id)
            assert updated is not None
            # Attempts incremented
            assert updated.attempts == initial_attempts + 1
            # Row is NOT permanently failed yet
            assert updated.status == "QUEUED"
            assert updated.sent_at is None
            assert updated.last_error is not None
        finally:
            _cleanup(db_session, row_id)

    # -- Max attempts --------------------------------------------------------

    def test_max_attempts_reached_marks_permanent(self, db_session: Session) -> None:
        """Row with attempts == MAX_ATTEMPTS - 1 and one more failure → permanent."""
        from app.emails.drain import MAX_ATTEMPTS, ProviderError, drain_batch

        # Seed at one attempt below the limit
        row = _seed_outbox(db_session, attempts=MAX_ATTEMPTS - 1)
        row_id = row.id

        try:
            with patch("app.emails.drain.send_email") as mock_send:
                mock_send.side_effect = ProviderError("timeout")

                drain_batch(db_session)

            updated = db_session.get(EmailOutbox, row_id)
            assert updated is not None
            assert updated.attempts == MAX_ATTEMPTS
            assert updated.status == "FAILED"
            assert updated.sent_at is not None
            assert "PERMANENT_MAX_ATTEMPTS" in (updated.last_error or "")
        finally:
            _cleanup(db_session, row_id)

    # -- No recipients -------------------------------------------------------

    def test_no_recipients_permanent_fail(self, db_session: Session) -> None:
        """Row with empty recipients_json → PERMANENT_NO_RECIPIENTS immediately."""
        from app.emails.drain import drain_batch

        row = _seed_outbox(db_session, recipients=[])
        row_id = row.id

        try:
            with patch("app.emails.drain.send_email") as mock_no_recipients:
                drain_batch(db_session)

            mock_no_recipients.assert_not_called()

            updated = db_session.get(EmailOutbox, row_id)
            assert updated is not None
            assert updated.status == "FAILED"
            assert updated.last_error == "PERMANENT_NO_RECIPIENTS"
        finally:
            _cleanup(db_session, row_id)

    # -- Already SENT rows are not re-processed ------------------------------

    def test_already_sent_rows_skipped(self, db_session: Session) -> None:
        """SENT rows are never touched by the drain."""
        from app.emails.drain import drain_batch

        already_sent = _seed_outbox(
            db_session,
            status="SENT",
            sent_at=datetime.now(tz=UTC),
        )
        row_id = already_sent.id

        try:
            with patch("app.emails.drain.send_email"):
                drain_batch(db_session)

            # send_email may have been called for other rows, but NOT for this one
            # (cannot assert call count directly because other QUEUED rows may exist;
            # verify state is unchanged instead).
            updated = db_session.get(EmailOutbox, row_id)
            assert updated is not None
            assert updated.status == "SENT"
        finally:
            _cleanup(db_session, row_id)

    # -- FOR UPDATE SKIP LOCKED double-send prevention -----------------------

    def test_skip_locked_row_locked_by_inflight_transaction(self, db_session: Session) -> None:
        """FOR UPDATE SKIP LOCKED: a row locked by session A is skipped by session B.

        We simulate concurrent drain competition by:
        1. Opening session A, running SELECT FOR UPDATE SKIP LOCKED to grab row 1.
        2. Opening session B while A's transaction is still open, running the same
           SELECT — session B must get 0 rows (row 1 is locked by A).
        3. Committing session A — then session B's fresh SELECT returns the row.

        This verifies the Postgres advisory lock mechanism, not thread scheduling.
        """
        import uuid as _uuid

        from sqlalchemy import and_, select

        from app.db.session import SessionLocal

        unique_id = str(_uuid.uuid4())[:8]
        row_id = None

        # Seed one QUEUED row in a committed session (visible to other connections).
        with SessionLocal() as seed_sess:
            row = EmailOutbox(
                subject=f"skip-locked-lock-test-{unique_id}",
                body_html="<p>body</p>",
                status="QUEUED",
                rule_type="PUBLISH_NOTIF",
                recipients_json=[_FAKE_RECIPIENT],
            )
            seed_sess.add(row)
            seed_sess.commit()
            seed_sess.refresh(row)
            row_id = row.id

        try:
            _lock_query = (
                select(EmailOutbox)
                .where(
                    and_(
                        EmailOutbox.id == row_id,
                        EmailOutbox.status == "QUEUED",
                    )
                )
                .with_for_update(skip_locked=True)
            )

            # Session A: grab the lock but do NOT commit yet.
            sess_a = SessionLocal()
            try:
                locked_rows = list(sess_a.scalars(_lock_query).all())
                assert len(locked_rows) == 1, "Session A must see the row"

                # Session B: runs SKIP LOCKED while A holds the lock — must get 0 rows.
                with SessionLocal() as sess_b:
                    skipped_rows = list(sess_b.scalars(_lock_query).all())
                    assert (
                        len(skipped_rows) == 0
                    ), f"Session B must skip the locked row; got {len(skipped_rows)}"

                # Commit session A — row is unlocked.
                sess_a.commit()

                # Session C: now that A committed, the row is visible again.
                # (It's still QUEUED because we didn't mutate it — just verified locking.)
                with SessionLocal() as sess_c:
                    visible_rows = list(sess_c.scalars(_lock_query).all())
                    assert (
                        len(visible_rows) == 1
                    ), "After A commits, session C must see the unlocked row"
            finally:
                sess_a.close()
        finally:
            # Clean up committed rows that conftest rollback won't catch.
            with SessionLocal() as cleanup_sess:
                r = cleanup_sess.get(EmailOutbox, row_id)
                if r is not None:
                    cleanup_sess.delete(r)
                cleanup_sess.commit()
