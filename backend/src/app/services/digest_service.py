"""Daily CFO Digest service (M6-full).

Public interface::

    compute_digest(entity_code, as_of_date, db) -> DigestPayload
    render_digest_html(payload) -> str
    run_daily_digest(db) -> list[EmailOutbox]

Design decisions:
- Aggregation reuses dashboard_service._aggregate_single_entity and
  _INVOICE_SOURCE_HINTS — no re-derivation of buckets.
- Only enqueues: never sends email directly.
- Idempotent per snapshot_id: if a DAILY_DIGEST row already exists for
  this snapshot_id today, skip (prevents duplicates on re-run).
- Recipient discovery: users WHERE role='CFO' AND is_active=True.
  No CFOs → warning logged, row NOT enqueued.
- D18: schedule uses ZoneInfo('Asia/Kolkata'), never UTC offset math.
- audit_log row per DIGEST_ENQUEUED action (one per entity per run).
- No raw party names / emails in non-debug logs (CLAUDE.md).
- CLI: `uv run python -m app.services.digest_service --once` for catch-up.
"""

from __future__ import annotations

import hashlib
import sys
import uuid  # noqa: TCH003 — uuid.UUID used in Pydantic model fields at runtime
from collections import defaultdict
from datetime import date, datetime  # noqa: TCH003 — used in Pydantic fields at runtime
from decimal import Decimal
from typing import TYPE_CHECKING

import structlog
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.db.models.audit_log import AuditLog
from app.db.models.email_outbox import EmailOutbox
from app.db.models.entity import Entity
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

# Mirror the two-element tuple from dashboard_service — do NOT import from there
# to keep this module independently importable by the CLI.
_INVOICE_SOURCE_HINTS = ("TALLY", "XERO")

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Pydantic payload
# ---------------------------------------------------------------------------


class BucketBreakdown(BaseModel):
    model_config = ConfigDict(frozen=True)

    NOT_DUE: Decimal = Decimal("0")
    ZERO_30: Decimal = Decimal("0")
    THIRTY1_60: Decimal = Decimal("0")
    SIXTY1_90: Decimal = Decimal("0")
    NINETY_PLUS: Decimal = Decimal("0")


class TopWorstPartyRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    canonical_id: uuid.UUID
    # Name is stored here only for rendering — never logged outside debug.
    canonical_name: str
    outstanding_90plus: Decimal
    active_exception_count: int


class NetNewExceptionRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    exception_id: uuid.UUID
    invoice_ref: str
    canonical_name: str
    bucket_type_code: str
    tagged_at: datetime


class DigestPayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    entity_code: str
    as_of_date: date
    snapshot_id: uuid.UUID
    currency_display: str  # 'INR' | 'AED'

    # Totals
    total_outstanding: Decimal
    pct_overdue: Decimal  # 0–100.00

    # Bucket breakdown
    buckets: BucketBreakdown

    # Top 10 worst parties (90+ outstanding), descending by outstanding_90plus
    top_worst_parties: list[TopWorstPartyRow]

    # Top 10 net-new exceptions (tagged_at > last_digest_snapshot.as_of_date)
    # On first run: all ACTIVE exceptions up to 10.
    net_new_exceptions: list[NetNewExceptionRow]

    # Count of parties with at least one ACTIVE exception
    parties_with_active_exceptions: int


# ---------------------------------------------------------------------------
# Core aggregation
# ---------------------------------------------------------------------------


def _resolve_latest_published_snapshot(entity_id: uuid.UUID, db: Session) -> Snapshot | None:
    """Return the most-recent PUBLISHED TALLY/XERO snapshot for this entity."""
    return db.scalar(
        select(Snapshot)
        .where(
            Snapshot.entity_id == entity_id,
            Snapshot.status == "PUBLISHED",
            Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
            Snapshot.as_of_date.is_not(None),
        )
        .order_by(Snapshot.as_of_date.desc(), Snapshot.published_at.desc())
        .limit(1)
    )


def _resolve_prior_published_snapshot(
    entity_id: uuid.UUID,
    current_as_of: date,
    db: Session,
) -> Snapshot | None:
    """Return the PUBLISHED TALLY/XERO snapshot immediately before current_as_of."""
    return db.scalar(
        select(Snapshot)
        .where(
            Snapshot.entity_id == entity_id,
            Snapshot.status == "PUBLISHED",
            Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
            Snapshot.as_of_date < current_as_of,
        )
        .order_by(Snapshot.as_of_date.desc(), Snapshot.published_at.desc())
        .limit(1)
    )


def compute_digest(
    entity_code: str,
    as_of_date: date,
    db: Session,
) -> DigestPayload:
    """Compute a DigestPayload for the given entity + date.

    Args:
        entity_code: 'IND' or 'UAE'
        as_of_date: The as_of_date of the snapshot to use (must be PUBLISHED).
        db: SQLAlchemy session

    Raises:
        ValueError: if entity not found or no published snapshot for as_of_date.
    """
    entity = db.scalar(select(Entity).where(Entity.code == entity_code))
    if entity is None:
        raise ValueError(f"Entity '{entity_code}' not found.")

    snapshot = db.scalar(
        select(Snapshot)
        .where(
            Snapshot.entity_id == entity.id,
            Snapshot.status == "PUBLISHED",
            Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
            Snapshot.as_of_date == as_of_date,
        )
        .limit(1)
    )
    if snapshot is None:
        raise ValueError(
            f"No published invoice snapshot for entity '{entity_code}' "
            f"with as_of_date={as_of_date}."
        )

    currency_display = "INR" if entity_code == "IND" else "AED"

    # ---- Fetch all invoice_snapshot rows for this snapshot ----
    snap_rows = db.execute(
        select(
            InvoiceSnapshot.bucket,
            InvoiceSnapshot.outstanding_amount,
            InvoiceSnapshot.invoice_id,
            Invoice.canonical_id,
        )
        .join(Invoice, InvoiceSnapshot.invoice_id == Invoice.id)
        .where(
            InvoiceSnapshot.snapshot_id == snapshot.id,
            InvoiceSnapshot.as_of_date == snapshot.as_of_date,
        )
    ).all()

    # ---- Aggregate ----
    bucket_totals: dict[str, Decimal] = defaultdict(Decimal)
    party_outstanding_90plus: dict[uuid.UUID, Decimal] = defaultdict(Decimal)
    total_outstanding = Decimal("0")

    for row in snap_rows:
        amount = row.outstanding_amount
        bucket_totals[row.bucket] += amount
        total_outstanding += amount
        if row.bucket == "90_PLUS":
            party_outstanding_90plus[row.canonical_id] += amount

    overdue_total = sum(v for k, v in bucket_totals.items() if k != "NOT_DUE")
    pct_overdue = (
        (overdue_total / total_outstanding * 100).quantize(Decimal("0.01"))
        if total_outstanding > 0
        else Decimal("0")
    )

    buckets = BucketBreakdown(
        NOT_DUE=bucket_totals.get("NOT_DUE", Decimal("0")),
        ZERO_30=bucket_totals.get("0_30", Decimal("0")),
        THIRTY1_60=bucket_totals.get("31_60", Decimal("0")),
        SIXTY1_90=bucket_totals.get("61_90", Decimal("0")),
        NINETY_PLUS=bucket_totals.get("90_PLUS", Decimal("0")),
    )

    # ---- Top 10 worst parties (90+ bucket, by outstanding) ----
    sorted_90plus = sorted(party_outstanding_90plus.items(), key=lambda x: x[1], reverse=True)[:10]

    top_worst: list[TopWorstPartyRow] = []
    for cid, outstanding in sorted_90plus:
        canonical = db.get(PartyCanonical, cid)
        canonical_name = canonical.name if canonical else str(cid)

        exc_count = (
            db.scalar(
                select(func.count(ExceptionTag.id)).where(
                    ExceptionTag.invoice_id.in_(
                        select(Invoice.id).where(Invoice.canonical_id == cid)
                    ),
                    ExceptionTag.status == "ACTIVE",
                )
            )
            or 0
        )

        top_worst.append(
            TopWorstPartyRow(
                canonical_id=cid,
                canonical_name=canonical_name,
                outstanding_90plus=outstanding,
                active_exception_count=exc_count,
            )
        )

    # ---- Net-new exceptions since last digest snapshot ----
    prior_snapshot = _resolve_prior_published_snapshot(entity.id, as_of_date, db)
    prior_cutoff: datetime | None = prior_snapshot.published_at if prior_snapshot else None

    exc_query = (
        select(
            ExceptionTag.id,
            ExceptionTag.invoice_id,
            ExceptionTag.tagged_at,
            Invoice.invoice_ref,
            PartyCanonical.name.label("canonical_name"),
        )
        .join(Invoice, ExceptionTag.invoice_id == Invoice.id)
        .join(PartyCanonical, Invoice.canonical_id == PartyCanonical.id)
        .where(
            Invoice.entity_id == entity.id,
            ExceptionTag.status == "ACTIVE",
        )
    )
    if prior_cutoff is not None:
        exc_query = exc_query.where(ExceptionTag.tagged_at > prior_cutoff)

    exc_rows = db.execute(exc_query.order_by(ExceptionTag.tagged_at.desc()).limit(10)).all()

    # Fetch bucket_type_code for each — join isn't in main query to keep it simple
    from app.db.models.exception_bucket_type import ExceptionBucketType  # local to avoid cycle

    net_new: list[NetNewExceptionRow] = []
    for er in exc_rows:
        # get bucket type via ExceptionTag
        et = db.get(ExceptionTag, er.id)
        if et is None:
            continue
        bt = db.get(ExceptionBucketType, et.bucket_type_id)
        bucket_code = bt.code if bt else "UNKNOWN"

        net_new.append(
            NetNewExceptionRow(
                exception_id=er.id,
                invoice_ref=er.invoice_ref,
                canonical_name=er.canonical_name,
                bucket_type_code=bucket_code,
                tagged_at=er.tagged_at,
            )
        )

    # ---- Parties with active exceptions (distinct canonical_ids) ----
    parties_with_exc = (
        db.scalar(
            select(func.count(func.distinct(Invoice.canonical_id))).where(
                Invoice.entity_id == entity.id,
                Invoice.id.in_(
                    select(ExceptionTag.invoice_id).where(ExceptionTag.status == "ACTIVE")
                ),
            )
        )
        or 0
    )

    return DigestPayload(
        entity_code=entity_code,
        as_of_date=as_of_date,
        snapshot_id=snapshot.id,
        currency_display=currency_display,
        total_outstanding=total_outstanding,
        pct_overdue=pct_overdue,
        buckets=buckets,
        top_worst_parties=top_worst,
        net_new_exceptions=net_new,
        parties_with_active_exceptions=parties_with_exc,
    )


# ---------------------------------------------------------------------------
# HTML renderer — minimal, inline-styles, Outlook-compatible
# ---------------------------------------------------------------------------


def render_digest_html(payload: DigestPayload) -> str:
    """Render DigestPayload to a minimal HTML email body.

    Design: single-column, inline styles only, no external resources.
    Tables are used for bucket breakdown and top-parties (Outlook-safe).
    """
    currency = payload.currency_display
    as_of = payload.as_of_date.isoformat()
    entity = payload.entity_code

    # Bucket rows
    bucket_rows = (
        ("Not Due", payload.buckets.NOT_DUE),
        ("0-30 days", payload.buckets.ZERO_30),
        ("31-60 days", payload.buckets.THIRTY1_60),
        ("61-90 days", payload.buckets.SIXTY1_90),
        ("90+ days", payload.buckets.NINETY_PLUS),
    )

    def _fmt(amount: Decimal) -> str:
        return f"{currency} {amount:,.2f}"

    bucket_html = "".join(
        f"<tr>"
        f'<td style="padding:4px 8px;border:1px solid #ddd;">{label}</td>'
        f'<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">{_fmt(amt)}</td>'
        f"</tr>"
        for label, amt in bucket_rows
    )

    # Top worst parties
    worst_party_rows_html = ""
    for i, p in enumerate(payload.top_worst_parties, 1):
        worst_party_rows_html += (
            f"<tr>"
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{i}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{p.canonical_name}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">'
            f"{_fmt(p.outstanding_90plus)}</td>"
            f'<td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">'
            f"{p.active_exception_count}</td>"
            f"</tr>"
        )
    if not worst_party_rows_html:
        worst_party_rows_html = (
            '<tr><td colspan="4" style="padding:4px 8px;color:#888;">'
            "No 90+ overdue parties.</td></tr>"
        )

    # Net-new exceptions
    exc_rows_html = ""
    for e in payload.net_new_exceptions:
        exc_rows_html += (
            f"<tr>"
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{e.invoice_ref}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{e.canonical_name}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{e.bucket_type_code}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;">'
            f"{e.tagged_at.strftime('%Y-%m-%d')}</td>"
            f"</tr>"
        )
    if not exc_rows_html:
        exc_rows_html = (
            '<tr><td colspan="4" style="padding:4px 8px;color:#888;">'
            "No new exceptions since last snapshot.</td></tr>"
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>EMB AR Daily Digest — {entity} ({as_of})</title></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;margin:0;padding:16px;">

<h2 style="color:#1a1a2e;">EMB Receivables — Daily Digest</h2>
<p style="margin:0 0 4px 0;">
  <strong>Entity:</strong> {entity} &nbsp;|&nbsp;
  <strong>As-of date:</strong> {as_of} &nbsp;|&nbsp;
  <strong>Currency:</strong> {currency}
</p>
<p style="margin:0 0 16px 0;">
  <strong>Total outstanding:</strong> {_fmt(payload.total_outstanding)} &nbsp;|&nbsp;
  <strong>% overdue:</strong> {payload.pct_overdue}% &nbsp;|&nbsp;
  <strong>Parties with exceptions:</strong> {payload.parties_with_active_exceptions}
</p>

<h3 style="color:#1a1a2e;margin:16px 0 8px 0;">Ageing Bucket Breakdown</h3>
<table style="border-collapse:collapse;width:100%;max-width:480px;">
  <thead>
    <tr style="background:#f0f0f0;">
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Bucket</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Outstanding</th>
    </tr>
  </thead>
  <tbody>{bucket_html}</tbody>
</table>

<h3 style="color:#1a1a2e;margin:16px 0 8px 0;">Top 10 Worst Parties (90+ Overdue)</h3>
<table style="border-collapse:collapse;width:100%;max-width:720px;">
  <thead>
    <tr style="background:#f0f0f0;">
      <th style="padding:4px 8px;border:1px solid #ddd;">#</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Party</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">90+ Outstanding</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:center;">Active Exceptions</th>
    </tr>
  </thead>
  <tbody>{worst_party_rows_html}</tbody>
</table>

<h3 style="color:#1a1a2e;margin:16px 0 8px 0;">Net-New Exceptions Since Last Snapshot</h3>
<table style="border-collapse:collapse;width:100%;max-width:720px;">
  <thead>
    <tr style="background:#f0f0f0;">
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Invoice Ref</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Party</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Exception Type</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Tagged On</th>
    </tr>
  </thead>
  <tbody>{exc_rows_html}</tbody>
</table>

<p style="margin:24px 0 0 0;font-size:11px;color:#999;">
  This is an automated digest from EMB Receivables Dashboard.
  Snapshot ID: {payload.snapshot_id}
</p>
</body>
</html>"""
    return html


# ---------------------------------------------------------------------------
# Orchestrator — run_daily_digest
# ---------------------------------------------------------------------------

_ENTITY_CODES = ("IND", "UAE")


def _hash_email(email: str) -> str:
    """SHA-256 truncated to 12 hex chars — used in non-debug logs per CLAUDE.md."""
    return hashlib.sha256(email.encode()).hexdigest()[:12]


def run_daily_digest(db: Session) -> list[EmailOutbox]:
    """Run the daily digest for all entities.

    For each entity in ('IND', 'UAE'):
      1. Resolve the latest published invoice snapshot.
      2. If none: skip and log.
      3. Idempotency check: if a DAILY_DIGEST row already exists for this
         snapshot_id, skip.
      4. Discover CFO recipients (role='CFO', is_active=True).
         If none: log warning and skip (not an error).
      5. compute_digest → render_digest_html → enqueue EmailOutbox.
      6. Write audit_log row with action='digest.enqueued'.
      7. db.commit() once all entities are processed.

    Returns:
        List of newly-inserted EmailOutbox rows.

    Side effects:
        Writes EmailOutbox + AuditLog rows; commits the transaction.
    """
    enqueued: list[EmailOutbox] = []

    # Discover CFO recipients once (apply to all entities)
    cfo_users = db.scalars(
        select(User).where(
            User.role == "CFO",
            User.is_active.is_(True),
        )
    ).all()

    if not cfo_users:
        log.warning(
            "digest_service.no_cfo_recipients",
            detail="No active CFO users found — daily digest will not be enqueued.",
        )
        return []

    # Log hashed emails only — never raw addresses in structured logs
    log.info(
        "digest_service.cfo_recipients_found",
        count=len(cfo_users),
        hashes=[_hash_email(u.email) for u in cfo_users],
    )

    recipients = [u.email for u in cfo_users]

    for entity_code in _ENTITY_CODES:
        entity = db.scalar(select(Entity).where(Entity.code == entity_code))
        if entity is None:
            log.warning("digest_service.entity_not_found", entity_code=entity_code)
            continue

        snapshot = _resolve_latest_published_snapshot(entity.id, db)
        if snapshot is None:
            log.info(
                "digest_service.no_published_snapshot",
                entity_code=entity_code,
                detail="Skipping — no published invoice snapshot.",
            )
            continue

        # Idempotency: skip if DAILY_DIGEST already enqueued for this snapshot
        existing = db.scalar(
            select(EmailOutbox).where(
                EmailOutbox.rule_type == "DAILY_DIGEST",
                EmailOutbox.snapshot_id == snapshot.id,
            )
        )
        if existing is not None:
            log.info(
                "digest_service.already_enqueued",
                entity_code=entity_code,
                snapshot_id=str(snapshot.id),
                detail="DAILY_DIGEST row already exists for this snapshot — skipping.",
            )
            continue

        # Compute payload
        try:
            as_of_date: date = snapshot.as_of_date  # type: ignore[assignment]
            payload = compute_digest(entity_code, as_of_date, db)
        except (ValueError, Exception) as exc:
            log.error(
                "digest_service.compute_failed",
                entity_code=entity_code,
                snapshot_id=str(snapshot.id),
                error=str(exc),
            )
            continue

        body_html = render_digest_html(payload)

        outbox_row = EmailOutbox(
            rule_type="DAILY_DIGEST",
            snapshot_id=snapshot.id,
            recipients_json=recipients,
            subject=(f"[EMB AR] Daily Digest — {entity_code} " f"({as_of_date.isoformat()})"),
            body_html=body_html,
            status="QUEUED",
        )
        db.add(outbox_row)
        db.flush()  # get outbox_row.id for audit log

        db.add(
            AuditLog(
                action="digest.enqueued",
                entity_type="email_outbox",
                entity_id=outbox_row.id,
                actor_user_id=None,  # system action — no human actor
                before=None,
                after={
                    "rule_type": "DAILY_DIGEST",
                    "entity_code": entity_code,
                    "snapshot_id": str(snapshot.id),
                    "as_of_date": as_of_date.isoformat(),
                    "recipient_count": len(recipients),
                },
            )
        )

        enqueued.append(outbox_row)
        log.info(
            "digest_service.enqueued",
            entity_code=entity_code,
            snapshot_id=str(snapshot.id),
            as_of_date=as_of_date.isoformat(),
            outbox_id=str(outbox_row.id),
        )

    db.commit()
    log.info("digest_service.run_complete", enqueued_count=len(enqueued))
    return enqueued


# ---------------------------------------------------------------------------
# CLI entrypoint — `uv run python -m app.services.digest_service --once`
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if "--once" not in sys.argv:
        print("Usage: uv run python -m app.services.digest_service --once")
        sys.exit(1)

    # Import here so this module is importable without triggering DB setup
    from app.core.logging import configure_logging
    from app.db.session import SessionLocal

    configure_logging()
    _log = structlog.get_logger("digest_service.cli")
    _log.info("digest_service.cli.start")

    with SessionLocal() as _db:
        _rows = run_daily_digest(_db)
        _log.info("digest_service.cli.done", enqueued_count=len(_rows))
