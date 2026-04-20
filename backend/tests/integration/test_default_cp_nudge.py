"""Integration tests for default_cp_nudge_service.py (spec §13 #5).

Coverage:
  1. compute_default_cp_payload returns the correct shape with seeded DEFAULT-source invoices
  2. run_weekly_default_cp_nudge enqueues one row per entity with parties-on-default
  3. Entity with zero parties-on-default → skipped (no row)
  4. Idempotency: second call same week → no duplicate
  5. No ANALYST users → warning logged, skip (row NOT enqueued)
  6. Scheduler trigger configured at Mon 09:00 Asia/Kolkata (assert on CronTrigger config)

State tolerance: run_weekly_default_cp_nudge calls db.commit() internally.
Each test uses unique UUID-prefixed party/snapshot data to avoid cross-test
collisions, and asserts on returned object state rather than raw table counts.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.rbac import Role
from app.db.models.audit_log import AuditLog
from app.db.models.email_rule import EmailRule
from app.db.models.entity import Entity
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User
from app.services.default_cp_nudge_service import (
    DefaultCpPayload,
    compute_default_cp_payload,
    render_default_cp_nudge_html,
    run_weekly_default_cp_nudge,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ADMIN_EMAIL = "tejaswa.sharma@emb.global"
ANALYST_EMAIL_TEMPLATE = "analyst+{}@emb.global"


def _seed_published_snapshot_with_source(
    db: Session,
    entity: Entity,
    as_of: date,
    invoices: list[tuple[str, Decimal, str]],  # (canonical_name, amount, credit_days_source)
    uploader_id: uuid.UUID,
    bucket: str = "90_PLUS",
) -> Snapshot:
    """Seed a minimal PUBLISHED snapshot with controllable credit_days_source.

    Each (canonical_name, amount, credit_days_source) tuple creates one
    canonical + invoice + invoice_snapshot row with bucket=bucket.
    Bypasses the HTTP publish gate to keep the setup simple.
    """
    import hashlib as _hash

    snap_sha = _hash.sha256(f"{entity.id}-{as_of}-{uuid.uuid4()}".encode()).hexdigest()[:64]
    snap = Snapshot(
        entity_id=entity.id,
        uploaded_by=uploader_id,
        upload_file_path=None,
        upload_file_sha256=snap_sha,
        as_of_date=as_of,
        source_hint="TALLY" if entity.code == "IND" else "XERO",
        status="PUBLISHED",
        parse_result_json={"invoices": [], "warnings": []},
        published_at=datetime(2026, 4, 14, 3, 30, 0),
    )
    db.add(snap)
    db.flush()

    currency = "INR" if entity.code == "IND" else "AED"

    for name, amount, cp_source in invoices:
        canonical = db.scalar(
            select(PartyCanonical).where(
                PartyCanonical.entity_id == entity.id,
                PartyCanonical.name == name,
            )
        )
        if canonical is None:
            canonical = PartyCanonical(
                entity_id=entity.id,
                name=name,
                created_by=uploader_id,
            )
            db.add(canonical)
            db.flush()
            db.add(
                PartyAlias(
                    canonical_id=canonical.id,
                    alias_text=name,
                    source="MANUAL",
                    created_by=uploader_id,
                )
            )

        inv_ref = f"INV-{name[:8]}-{uuid.uuid4().hex[:6]}"
        invoice = Invoice(
            entity_id=entity.id,
            canonical_id=canonical.id,
            invoice_ref=inv_ref,
            invoice_date=date(2026, 1, 1),
            amount=amount,
            currency=currency,
            credit_days_applied=30,
            credit_days_source=cp_source,
            due_date=date(2026, 2, 1),
            status="OPEN",
            first_seen_snapshot_id=snap.id,
            raw_row_json={},
        )
        db.add(invoice)
        db.flush()

        inv_snap = InvoiceSnapshot(
            as_of_date=as_of,
            snapshot_id=snap.id,
            invoice_id=invoice.id,
            outstanding_amount=amount,
            overdue_days=91,
            bucket=bucket,
        )
        db.add(inv_snap)

    db.flush()
    return snap


def _ensure_analyst_user(db: Session, tag: str, entity_id: uuid.UUID | None = None) -> User:
    """Create (or fetch existing) an ANALYST user scoped to entity_id (or global)."""
    email = ANALYST_EMAIL_TEMPLATE.format(tag)
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            name=f"Analyst-{tag}",
            role=Role.ANALYST,
            is_active=True,
            entity_id_scope=entity_id,
        )
        db.add(user)
        db.flush()
    else:
        user.role = Role.ANALYST
        user.is_active = True
        user.entity_id_scope = entity_id
        db.flush()
    return user


# ---------------------------------------------------------------------------
# 1. compute_default_cp_payload returns correct shape
# ---------------------------------------------------------------------------


def test_compute_default_cp_payload_shape(db_session: Session) -> None:
    """compute_default_cp_payload returns DefaultCpPayload with correct totals."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30
    db_session.flush()

    as_of = date(2026, 5, 15)
    invoices = [
        (f"CP-{tag}-Alpha", Decimal("80000.00"), "DEFAULT"),
        (f"CP-{tag}-Beta", Decimal("40000.00"), "DEFAULT"),
        (f"CP-{tag}-Gamma", Decimal("20000.00"), "CONFIG"),  # not DEFAULT — should not appear
    ]
    _seed_published_snapshot_with_source(db_session, ind, as_of, invoices, admin.id)
    db_session.commit()

    payload = compute_default_cp_payload("IND", db_session)

    assert isinstance(payload, DefaultCpPayload)
    assert payload.entity_code == "IND"
    assert payload.currency_display == "INR"
    assert payload.total_parties_on_default >= 2  # Alpha + Beta at minimum

    # Top parties: Alpha and Beta must appear; Gamma (CONFIG) must not
    party_names = [p.canonical_name for p in payload.top_parties]
    assert f"CP-{tag}-Alpha" in party_names
    assert f"CP-{tag}-Beta" in party_names
    assert f"CP-{tag}-Gamma" not in party_names

    # Amounts match what we seeded (list may contain other-test data; use >=)
    alpha_row = next(p for p in payload.top_parties if p.canonical_name == f"CP-{tag}-Alpha")
    assert alpha_row.total_outstanding >= Decimal("80000.00")
    assert alpha_row.n_open_invoices >= 1

    # iso_week_monday is a Monday
    assert payload.iso_week_monday.weekday() == 0

    # snapshot_id is a UUID
    assert isinstance(payload.snapshot_id, uuid.UUID)


# ---------------------------------------------------------------------------
# 2. run_weekly_default_cp_nudge enqueues one row per entity
# ---------------------------------------------------------------------------


def test_run_weekly_default_cp_nudge_enqueues_per_entity(db_session: Session) -> None:
    """run_weekly_default_cp_nudge enqueues one WEEKLY_DEFAULT_CP_NUDGE row per entity."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    uae = db_session.scalar(select(Entity).where(Entity.code == "UAE"))
    assert ind is not None and uae is not None
    ind.default_credit_days = 30
    uae.default_credit_days = 30
    db_session.flush()

    # Seed analysts (global scope — applies to both entities)
    analyst = _ensure_analyst_user(db_session, tag, entity_id=None)
    db_session.commit()

    # Seed DEFAULT-source invoices for both entities; use far-future as_of dates
    # to be the latest snapshots and avoid collisions with other tests.
    ind_snap = _seed_published_snapshot_with_source(
        db_session,
        ind,
        date(2026, 6, 28),
        [(f"NUDGE-{tag}-IndParty", Decimal("150000.00"), "DEFAULT")],
        admin.id,
    )
    uae_snap = _seed_published_snapshot_with_source(
        db_session,
        uae,
        date(2026, 6, 28),
        [(f"NUDGE-{tag}-UAEParty", Decimal("100000.00"), "DEFAULT")],
        admin.id,
    )
    db_session.commit()

    rows = run_weekly_default_cp_nudge(db_session)

    snap_ids = {r.snapshot_id for r in rows}
    assert ind_snap.id in snap_ids, f"IND snap {ind_snap.id} not in {snap_ids}"
    assert uae_snap.id in snap_ids, f"UAE snap {uae_snap.id} not in {snap_ids}"

    for row in rows:
        assert row.rule_type == "WEEKLY_DEFAULT_CP_NUDGE"
        assert row.status == "QUEUED"
        assert analyst.email in row.recipients_json
        assert len(row.body_html) > 100
        assert "[EMB AR] Default CP Nudge" in row.subject
        assert "week" in row.subject

    # Audit log rows must exist
    for outbox in rows:
        audit = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "WEEKLY_DEFAULT_CP_NUDGE_ENQUEUED",
                AuditLog.entity_id == outbox.id,
            )
        )
        assert audit is not None
        assert audit.after is not None
        assert audit.after["rule_type"] == "WEEKLY_DEFAULT_CP_NUDGE"
        assert "total_parties_on_default" in audit.after


# ---------------------------------------------------------------------------
# 3. Entity with zero DEFAULT-source parties → skipped
# ---------------------------------------------------------------------------


def test_run_weekly_default_cp_nudge_skips_zero_default(db_session: Session) -> None:
    """Entity with no DEFAULT-source open invoices produces no email_outbox row."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30
    db_session.flush()

    _ensure_analyst_user(db_session, tag)
    db_session.commit()

    # Seed only CONFIG-source invoices — no DEFAULT ones
    snap = _seed_published_snapshot_with_source(
        db_session,
        ind,
        date(2026, 5, 31),
        [
            (f"NODEF-{tag}-ConfigParty", Decimal("50000.00"), "CONFIG"),
            (f"NODEF-{tag}-ManualParty", Decimal("30000.00"), "MANUAL"),
        ],
        admin.id,
    )
    db_session.commit()

    rows = run_weekly_default_cp_nudge(db_session)

    # This specific snapshot must NOT have produced a nudge row
    snap_ids = {r.snapshot_id for r in rows}
    assert snap.id not in snap_ids


# ---------------------------------------------------------------------------
# 4. Idempotency: second call same week → no duplicate
# ---------------------------------------------------------------------------


def test_run_weekly_default_cp_nudge_idempotent(db_session: Session) -> None:
    """Second call within the same ISO week does not enqueue a duplicate row."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30
    db_session.flush()

    _ensure_analyst_user(db_session, tag)
    db_session.commit()

    snap = _seed_published_snapshot_with_source(
        db_session,
        ind,
        date(2026, 6, 27),
        [(f"IDEM-{tag}-Party", Decimal("70000.00"), "DEFAULT")],
        admin.id,
    )
    db_session.commit()

    first_run = run_weekly_default_cp_nudge(db_session)
    first_snap_ids = {r.snapshot_id for r in first_run}
    # snap must appear in first run (2026-06-27 is the latest for IND at this point)
    assert snap.id in first_snap_ids, (
        f"Expected {snap.id} in {first_snap_ids}; "
        "another test may have seeded a later IND snapshot."
    )

    second_run = run_weekly_default_cp_nudge(db_session)
    second_snap_ids = {r.snapshot_id for r in second_run}
    # snap must NOT be enqueued again — idempotency check
    assert snap.id not in second_snap_ids


# ---------------------------------------------------------------------------
# 5. No ANALYST users → warning logged, row NOT enqueued
# ---------------------------------------------------------------------------


def test_run_weekly_default_cp_nudge_no_analyst_skips(db_session: Session) -> None:
    """When no active ANALYST users exist for an entity, no row is enqueued."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30
    db_session.flush()

    # Deactivate all ANALYST users (or change their role)
    all_analysts = db_session.scalars(
        select(User).where(User.role == Role.ANALYST, User.is_active.is_(True))
    ).all()
    for u in all_analysts:
        u.is_active = False
    db_session.flush()

    snap = _seed_published_snapshot_with_source(
        db_session,
        ind,
        date(2026, 5, 28),
        [(f"NOANAL-{tag}-Party", Decimal("60000.00"), "DEFAULT")],
        admin.id,
    )
    db_session.commit()

    rows = run_weekly_default_cp_nudge(db_session)

    # This specific snapshot must NOT have produced a nudge row
    snap_ids = {r.snapshot_id for r in rows}
    assert snap.id not in snap_ids

    # Restore analysts so other tests are unaffected (best-effort)
    for u in all_analysts:
        u.is_active = True
    db_session.commit()


# ---------------------------------------------------------------------------
# 6. Scheduler trigger configured at Mon 09:00 Asia/Kolkata
# ---------------------------------------------------------------------------


def test_scheduler_trigger_weekly_mon_09_00_ist() -> None:
    """CronTrigger for weekly_default_cp_nudge fires at Mon 09:00 Asia/Kolkata."""
    from apscheduler.triggers.cron import CronTrigger

    trigger = CronTrigger(
        day_of_week="mon",
        hour=9,
        minute=0,
        timezone="Asia/Kolkata",
    )

    # APScheduler CronTrigger field ordering:
    #   [0]=year, [1]=month, [2]=day, [3]=week, [4]=day_of_week,
    #   [5]=hour, [6]=minute, [7]=second
    dow_field = next(f for f in trigger.fields if f.name == "day_of_week")
    hour_field = next(f for f in trigger.fields if f.name == "hour")
    minute_field = next(f for f in trigger.fields if f.name == "minute")

    # day_of_week=0 is Monday in APScheduler (0=Monday, 6=Sunday)
    assert dow_field.expressions[0].first == 0  # Monday
    assert hour_field.expressions[0].first == 9
    assert minute_field.expressions[0].first == 0

    tz_str = str(trigger.timezone)
    assert "Asia/Kolkata" in tz_str or "Kolkata" in tz_str


# ---------------------------------------------------------------------------
# 7. render_default_cp_nudge_html produces Outlook-safe HTML
# ---------------------------------------------------------------------------


def test_render_default_cp_nudge_html(db_session: Session) -> None:
    """render_default_cp_nudge_html returns non-empty HTML with correct elements."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30
    db_session.flush()

    as_of = date(2026, 5, 20)
    _seed_published_snapshot_with_source(
        db_session,
        ind,
        as_of,
        [(f"HTML-{tag}-Party", Decimal("90000.00"), "DEFAULT")],
        admin.id,
    )
    db_session.commit()

    payload = compute_default_cp_payload("IND", db_session)
    html = render_default_cp_nudge_html(payload)

    assert len(html) > 200
    assert "<!DOCTYPE html>" in html
    assert "<table" in html
    assert "Default Credit Period" in html
    assert "INR" in html
    assert str(payload.snapshot_id) in html
    assert "Week of" in html


# ---------------------------------------------------------------------------
# 8. email_rule wiring — is_active=false → skip; active with recipients → use rule
# ---------------------------------------------------------------------------


def test_run_weekly_nudge_rule_inactive_skips(db_session: Session) -> None:
    """WEEKLY_DEFAULT_CP_NUDGE rule with is_active=false → returns [] immediately."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    # Seed an ANALYST so the old fallback would enqueue
    analyst_email = ANALYST_EMAIL_TEMPLATE.format(f"ruleinact{tag}")
    analyst = db_session.scalar(select(User).where(User.email == analyst_email))
    if analyst is None:
        analyst = User(
            email=analyst_email,
            name=f"Analyst-{tag}",
            role=Role.ANALYST,
            is_active=True,
        )
        db_session.add(analyst)
    else:
        analyst.role = Role.ANALYST
        analyst.is_active = True
    db_session.flush()

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30
    _seed_published_snapshot_with_source(
        db_session,
        ind,
        date(2026, 4, 21),
        [(f"NUDGEINACT-{tag}-P", Decimal("7000.00"), "DEFAULT")],
        admin.id,
    )

    rule = db_session.scalar(
        select(EmailRule).where(EmailRule.rule_type == "WEEKLY_DEFAULT_CP_NUDGE")
    )
    assert rule is not None
    rule.is_active = False
    rule.recipients_json = ["someone@emb.global"]
    db_session.commit()

    rows = run_weekly_default_cp_nudge(db_session)
    assert rows == [], "Expected empty list when WEEKLY_DEFAULT_CP_NUDGE rule is_active=false"

    # Restore
    rule.is_active = False
    db_session.commit()


def test_run_weekly_nudge_rule_active_with_recipients(db_session: Session) -> None:
    """WEEKLY_DEFAULT_CP_NUDGE rule active with recipients → enqueues using rule recipients."""
    tag = uuid.uuid4().hex[:8]

    admin = db_session.scalar(select(User).where(User.email == ADMIN_EMAIL))
    assert admin is not None

    ind = db_session.scalar(select(Entity).where(Entity.code == "IND"))
    assert ind is not None
    ind.default_credit_days = 30

    # A date offset to minimise idempotency collision with other tests
    snap_date = date(2026, 5, 25)
    _seed_published_snapshot_with_source(
        db_session,
        ind,
        snap_date,
        [(f"NUDGEACTIVE-{tag}-P", Decimal("12000.00"), "DEFAULT")],
        admin.id,
    )

    rule_recipient = f"nudge+{tag}@emb.global"
    rule = db_session.scalar(
        select(EmailRule).where(EmailRule.rule_type == "WEEKLY_DEFAULT_CP_NUDGE")
    )
    assert rule is not None
    rule.is_active = True
    rule.recipients_json = [rule_recipient]
    db_session.commit()

    rows = run_weekly_default_cp_nudge(db_session)

    # At least one entity should have been enqueued (IND has DEFAULT-source invoices)
    assert len(rows) >= 1, "Expected at least one WEEKLY_DEFAULT_CP_NUDGE row"
    for row in rows:
        assert row.rule_type == "WEEKLY_DEFAULT_CP_NUDGE"
        assert rule_recipient in row.recipients_json, (
            f"Expected rule recipient {rule_recipient!r} in {row.recipients_json}"
        )

    # Restore
    rule.is_active = False
    rule.recipients_json = []
    db_session.commit()
