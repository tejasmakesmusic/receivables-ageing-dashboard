"""Weekly analyst nudge for parties on entity-default credit period (spec §13 #5).

Parties whose invoices carry ``credit_days_source='DEFAULT'`` have not had a
credit period configured via admin config (D8).  A weekly email to ANALYST
users surfaces those parties so they can be actioned.

Public interface::

    compute_default_cp_payload(entity_code, db) -> DefaultCpPayload
    render_default_cp_nudge_html(payload) -> str
    run_weekly_default_cp_nudge(db) -> list[EmailOutbox]

Design decisions:
- Only enqueues — never sends directly.
- Idempotency: one WEEKLY_DEFAULT_CP_NUDGE row per (entity_code, ISO week).
  Uses the Monday date of the current ISO week as the idempotency key stored
  in the subject; the DB check looks for an existing row with the same
  subject prefix for this entity since the week started.
- If total_parties_on_default == 0 for an entity → skip (no row, no log noise).
- Recipient discovery: ANALYST users where is_active=True AND
  (entity_id_scope = entity.id OR entity_id_scope IS NULL).
- No ANALYST users → warning logged, row NOT enqueued.
- Top 20 parties by total outstanding among DEFAULT-source invoices.
- Uses the latest PUBLISHED TALLY/XERO snapshot for the entity to scope
  invoice_snapshot rows (consistent with dashboard_service).
- D14: do NOT back-fill historical nudges.
- D18: schedule uses 'Asia/Kolkata' timezone (see scheduler.py).
- Recipient email addresses + party names redacted in non-debug logs (CLAUDE.md).
- Every enqueue writes an audit_log row with action='WEEKLY_DEFAULT_CP_NUDGE_ENQUEUED'.
- CLI: ``uv run python -m app.services.default_cp_nudge_service --once``
"""

from __future__ import annotations

import hashlib
import sys
import uuid  # noqa: TCH003 — uuid.UUID used in Pydantic fields at runtime
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING

import structlog
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.db.models.audit_log import AuditLog
from app.db.models.email_outbox import EmailOutbox
from app.db.models.email_rule import EmailRule
from app.db.models.entity import Entity
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

# Mirror the two-element tuple from digest_service — do NOT import from there
# to keep this module independently importable by the CLI.
_INVOICE_SOURCE_HINTS = ("TALLY", "XERO")

_ENTITY_CODES = ("IND", "UAE")

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Pydantic payload
# ---------------------------------------------------------------------------


class DefaultCpPartyRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    canonical_id: uuid.UUID
    # Name stored only for rendering — never logged outside debug (CLAUDE.md).
    canonical_name: str
    total_outstanding: Decimal
    n_open_invoices: int


class DefaultCpPayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    entity_code: str
    as_of_date: date
    snapshot_id: uuid.UUID
    currency_display: str  # 'INR' | 'AED'
    iso_week_monday: date  # Monday of the current ISO week (idempotency key)
    total_parties_on_default: int
    # Top 20 parties on DEFAULT credit period, descending by total_outstanding.
    top_parties: list[DefaultCpPartyRow]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_week_monday(ref: date | None = None) -> date:
    """Return the Monday of the ISO week containing *ref* (default: today)."""
    d = ref or date.today()
    return d - timedelta(days=d.weekday())


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


def _hash_email(email: str) -> str:
    """SHA-256 truncated to 12 hex chars — used in non-debug logs (CLAUDE.md)."""
    return hashlib.sha256(email.encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------


def compute_default_cp_payload(entity_code: str, db: Session) -> DefaultCpPayload:
    """Compute a DefaultCpPayload for the given entity.

    Args:
        entity_code: 'IND' or 'UAE'
        db: SQLAlchemy session

    Raises:
        ValueError: if entity not found or no published snapshot exists.

    Returns:
        DefaultCpPayload — caller should check ``total_parties_on_default == 0``
        before deciding whether to enqueue.
    """
    entity = db.scalar(select(Entity).where(Entity.code == entity_code))
    if entity is None:
        raise ValueError(f"Entity '{entity_code}' not found.")

    snapshot = _resolve_latest_published_snapshot(entity.id, db)
    if snapshot is None:
        raise ValueError(
            f"No published invoice snapshot for entity '{entity_code}'."
        )

    currency_display = "INR" if entity_code == "IND" else "AED"
    as_of_date: date = snapshot.as_of_date  # type: ignore[assignment]
    week_monday = _iso_week_monday()

    # ------------------------------------------------------------------
    # Aggregate outstanding amounts + open-invoice counts per canonical
    # party, scoped to DEFAULT-source invoices in the latest snapshot.
    # ------------------------------------------------------------------
    rows = db.execute(
        select(
            Invoice.canonical_id,
            func.sum(InvoiceSnapshot.outstanding_amount).label("total_outstanding"),
            func.count(Invoice.id).label("n_open_invoices"),
        )
        .join(InvoiceSnapshot, InvoiceSnapshot.invoice_id == Invoice.id)
        .where(
            InvoiceSnapshot.snapshot_id == snapshot.id,
            InvoiceSnapshot.as_of_date == as_of_date,
            Invoice.credit_days_source == "DEFAULT",
            Invoice.status == "OPEN",
        )
        .group_by(Invoice.canonical_id)
        .order_by(func.sum(InvoiceSnapshot.outstanding_amount).desc())
        .limit(20)
    ).all()

    # Total distinct parties with DEFAULT source in this snapshot (for skip check).
    total_parties_on_default: int = (
        db.scalar(
            select(func.count(func.distinct(Invoice.canonical_id))).where(
                Invoice.entity_id == entity.id,
                Invoice.credit_days_source == "DEFAULT",
                Invoice.status == "OPEN",
                Invoice.id.in_(
                    select(InvoiceSnapshot.invoice_id).where(
                        InvoiceSnapshot.snapshot_id == snapshot.id,
                        InvoiceSnapshot.as_of_date == as_of_date,
                    )
                ),
            )
        )
        or 0
    )

    top_parties: list[DefaultCpPartyRow] = []
    for row in rows:
        canonical = db.get(PartyCanonical, row.canonical_id)
        canonical_name = canonical.name if canonical else str(row.canonical_id)
        top_parties.append(
            DefaultCpPartyRow(
                canonical_id=row.canonical_id,
                canonical_name=canonical_name,
                total_outstanding=row.total_outstanding or Decimal("0"),
                n_open_invoices=row.n_open_invoices or 0,
            )
        )

    return DefaultCpPayload(
        entity_code=entity_code,
        as_of_date=as_of_date,
        snapshot_id=snapshot.id,
        currency_display=currency_display,
        iso_week_monday=week_monday,
        total_parties_on_default=total_parties_on_default,
        top_parties=top_parties,
    )


# ---------------------------------------------------------------------------
# HTML renderer — Outlook-safe inline-style, mirrors digest_service style
# ---------------------------------------------------------------------------


def render_default_cp_nudge_html(payload: DefaultCpPayload) -> str:
    """Render DefaultCpPayload to a minimal, Outlook-safe HTML email body.

    Single-column, inline styles only, no external resources.
    """
    currency = payload.currency_display
    entity = payload.entity_code
    as_of = payload.as_of_date.isoformat()
    week_label = f"Week of {payload.iso_week_monday.isoformat()}"

    def _fmt(amount: Decimal) -> str:
        return f"{currency} {amount:,.2f}"

    party_rows_html = ""
    for i, p in enumerate(payload.top_parties, 1):
        party_rows_html += (
            f"<tr>"
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{i}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;">{p.canonical_name}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">'
            f"{_fmt(p.total_outstanding)}</td>"
            f'<td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">'
            f"{p.n_open_invoices}</td>"
            f"</tr>"
        )
    if not party_rows_html:
        party_rows_html = (
            '<tr><td colspan="4" style="padding:4px 8px;color:#888;">'
            "No parties on default credit period.</td></tr>"
        )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>EMB AR — Default CP Nudge — {entity} ({week_label})</title></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;margin:0;padding:16px;">

<h2 style="color:#1a1a2e;">EMB Receivables — Default Credit Period Nudge</h2>
<p style="margin:0 0 4px 0;">
  <strong>Entity:</strong> {entity} &nbsp;|&nbsp;
  <strong>As-of date:</strong> {as_of} &nbsp;|&nbsp;
  <strong>{week_label}</strong>
</p>
<p style="margin:0 0 16px 0;">
  The following <strong>{payload.total_parties_on_default}</strong>
  {entity} {'party has' if payload.total_parties_on_default == 1 else 'parties have'}
  open invoices using the <em>entity default</em> credit period
  (no party-specific credit period configured in Admin&nbsp;&rsaquo;&nbsp;Credit Period Config).
  Please review and update where applicable.
</p>

<h3 style="color:#1a1a2e;margin:16px 0 8px 0;">
  Top {len(payload.top_parties)} Parties on Default Credit Period
  (by outstanding amount)
</h3>
<table style="border-collapse:collapse;width:100%;max-width:720px;">
  <thead>
    <tr style="background:#f0f0f0;">
      <th style="padding:4px 8px;border:1px solid #ddd;">#</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Party</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Total Outstanding</th>
      <th style="padding:4px 8px;border:1px solid #ddd;text-align:center;">Open Invoices</th>
    </tr>
  </thead>
  <tbody>{party_rows_html}</tbody>
</table>

<p style="margin:16px 0 0 0;font-size:12px;color:#555;">
  To resolve: navigate to <em>Admin &rsaquo; Credit Period Config</em> and set
  a party-specific credit period for each party listed above.
</p>
<p style="margin:24px 0 0 0;font-size:11px;color:#999;">
  This is an automated weekly nudge from EMB Receivables Dashboard.
  Snapshot ID: {payload.snapshot_id}
</p>
</body>
</html>"""
    return html


# ---------------------------------------------------------------------------
# Orchestrator — run_weekly_default_cp_nudge
# ---------------------------------------------------------------------------


def run_weekly_default_cp_nudge(db: Session) -> list[EmailOutbox]:  # noqa: PLR0912 PLR0915
    """Run the weekly default-CP nudge for all entities.

    For each entity in ('IND', 'UAE'):
      1. Resolve latest published invoice snapshot.
      2. compute_default_cp_payload; if total_parties_on_default == 0 → skip.
      3. Idempotency: if a WEEKLY_DEFAULT_CP_NUDGE row already exists in
         email_outbox for this entity + current ISO week → skip.
      4. Discover ANALYST recipients (entity-scoped: role='ANALYST',
         is_active=True, entity_id_scope IN (entity.id, NULL)).
         No ANALYSTs → warning logged, skip.
      5. render_default_cp_nudge_html → enqueue EmailOutbox row.
      6. Write audit_log row with action='WEEKLY_DEFAULT_CP_NUDGE_ENQUEUED'.
      7. db.commit() once all entities processed.

    Returns:
        List of newly-inserted EmailOutbox rows.

    Side effects:
        Writes EmailOutbox + AuditLog rows; commits the transaction.
    """
    enqueued: list[EmailOutbox] = []
    week_monday = _iso_week_monday()

    # --- Recipient resolution: read from email_rules; fall back to role-discovery ---
    email_rule = db.scalar(
        select(EmailRule).where(EmailRule.rule_type == "WEEKLY_DEFAULT_CP_NUDGE")
    )

    _rule_recipients: list[str] | None  # None → use per-entity fallback below
    if email_rule is not None:
        if not email_rule.is_active:
            log.info(
                "default_cp_nudge.rule_inactive",
                detail="WEEKLY_DEFAULT_CP_NUDGE email rule is_active=false — skipping.",
            )
            return []

        if not email_rule.recipients_json:
            log.info(
                "default_cp_nudge.rule_empty_recipients",
                detail="WEEKLY_DEFAULT_CP_NUDGE email rule has no recipients — skipping.",
            )
            return []

        _rule_recipients = list(email_rule.recipients_json)
        log.info(
            "default_cp_nudge.recipients_from_rule",
            count=len(_rule_recipients),
        )
    else:
        log.warning(
            "default_cp_nudge.no_email_rule_row",
            detail=(
                "No WEEKLY_DEFAULT_CP_NUDGE row in email_rules — "
                "falling back to ANALYST role discovery."
            ),
        )
        _rule_recipients = None  # signal to do per-entity fallback

    for entity_code in _ENTITY_CODES:
        entity = db.scalar(select(Entity).where(Entity.code == entity_code))
        if entity is None:
            log.warning(
                "default_cp_nudge.entity_not_found",
                entity_code=entity_code,
            )
            continue

        # ------------------------------------------------------------------
        # Compute payload
        # ------------------------------------------------------------------
        try:
            payload = compute_default_cp_payload(entity_code, db)
        except ValueError as exc:
            log.info(
                "default_cp_nudge.skipped_no_snapshot",
                entity_code=entity_code,
                reason=str(exc),
            )
            continue
        except Exception:
            log.exception(
                "default_cp_nudge.compute_failed",
                entity_code=entity_code,
            )
            continue

        if payload.total_parties_on_default == 0:
            log.info(
                "default_cp_nudge.zero_default_parties_skip",
                entity_code=entity_code,
                detail="No parties on default CP — nudge not enqueued.",
            )
            continue

        # ------------------------------------------------------------------
        # Idempotency: one row per entity per ISO week.
        # Key: subject prefix includes entity_code + week_monday ISO string.
        # ------------------------------------------------------------------
        week_tag = f"[EMB AR] Default CP Nudge — {entity_code} (week {week_monday.isoformat()})"
        existing = db.scalar(
            select(EmailOutbox).where(
                EmailOutbox.rule_type == "WEEKLY_DEFAULT_CP_NUDGE",
                EmailOutbox.subject == week_tag,
            )
        )
        if existing is not None:
            log.info(
                "default_cp_nudge.already_enqueued",
                entity_code=entity_code,
                week_monday=week_monday.isoformat(),
                detail="WEEKLY_DEFAULT_CP_NUDGE row already exists for this week — skipping.",
            )
            continue

        # ------------------------------------------------------------------
        # Recipient resolution: from email_rule or fallback to ANALYST users
        # ------------------------------------------------------------------
        if _rule_recipients is not None:
            recipients = _rule_recipients
        else:
            analyst_users = db.scalars(
                select(User).where(
                    User.role == "ANALYST",
                    User.is_active.is_(True),
                    (User.entity_id_scope == entity.id)
                    | (User.entity_id_scope.is_(None)),
                )
            ).all()

            if not analyst_users:
                log.warning(
                    "default_cp_nudge.no_analyst_recipients",
                    entity_code=entity_code,
                    detail=(
                        "No active ANALYST users found for this entity — nudge not enqueued."
                    ),
                )
                continue

            # Log hashed emails only (CLAUDE.md data-handling rule)
            log.info(
                "default_cp_nudge.analyst_recipients_found",
                entity_code=entity_code,
                count=len(analyst_users),
                hashes=[_hash_email(u.email) for u in analyst_users],
            )

            recipients = [u.email for u in analyst_users]

        # ------------------------------------------------------------------
        # Render + enqueue
        # ------------------------------------------------------------------
        body_html = render_default_cp_nudge_html(payload)

        outbox_row = EmailOutbox(
            rule_type="WEEKLY_DEFAULT_CP_NUDGE",
            snapshot_id=payload.snapshot_id,
            recipients_json=recipients,
            subject=week_tag,
            body_html=body_html,
            status="QUEUED",
        )
        db.add(outbox_row)
        db.flush()  # get outbox_row.id for audit log

        db.add(
            AuditLog(
                action="WEEKLY_DEFAULT_CP_NUDGE_ENQUEUED",
                entity_type="email_outbox",
                entity_id=outbox_row.id,
                actor_user_id=None,  # system action — no human actor
                before=None,
                after={
                    "rule_type": "WEEKLY_DEFAULT_CP_NUDGE",
                    "entity_code": entity_code,
                    "snapshot_id": str(payload.snapshot_id),
                    "as_of_date": payload.as_of_date.isoformat(),
                    "iso_week_monday": week_monday.isoformat(),
                    "total_parties_on_default": payload.total_parties_on_default,
                    "recipient_count": len(recipients),
                },
            )
        )

        enqueued.append(outbox_row)
        log.info(
            "default_cp_nudge.enqueued",
            entity_code=entity_code,
            snapshot_id=str(payload.snapshot_id),
            as_of_date=payload.as_of_date.isoformat(),
            week_monday=week_monday.isoformat(),
            total_parties_on_default=payload.total_parties_on_default,
            outbox_id=str(outbox_row.id),
        )

    db.commit()
    log.info("default_cp_nudge.run_complete", enqueued_count=len(enqueued))
    return enqueued


# ---------------------------------------------------------------------------
# CLI entrypoint — `uv run python -m app.services.default_cp_nudge_service --once`
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if "--once" not in sys.argv:
        print(
            "Usage: uv run python -m app.services.default_cp_nudge_service --once"
        )
        sys.exit(1)

    # Import here so this module is importable without triggering DB setup.
    from app.core.logging import configure_logging
    from app.db.session import SessionLocal

    configure_logging()
    _log = structlog.get_logger("default_cp_nudge_service.cli")
    _log.info("default_cp_nudge_service.cli.start")

    with SessionLocal() as _db:
        _rows = run_weekly_default_cp_nudge(_db)
        _log.info("default_cp_nudge_service.cli.done", enqueued_count=len(_rows))
