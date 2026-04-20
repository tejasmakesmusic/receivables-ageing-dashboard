"""Dashboard service — aggregates for GET /dashboard (M4 D1).

Public interface::

    get_dashboard(entity, as_of, db) -> DashboardResponse

Design decisions:
- Aggregates are computed fresh on each request from invoice_snapshots.
- For entity=ALL: per-invoice AED→INR conversion pinned by invoice_date.
- No clock reads: as_of_date comes from snapshot.as_of_date exclusively.
- FX rate lookup is cached within one request (build_rate_cache).
- parties_on_default_credit_period_count: count of OPEN invoices where
  credit_days_source = 'DEFAULT' (distinct canonical_ids).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Literal

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.follow_up import FollowUp
from app.db.models.fx_rate import FxRate
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User
from app.schemas.dashboard import (
    DashboardKPIs,
    DashboardResponse,
    DashboardTrendRow,
    RecentExceptionRow,
    TopPartyRow,
)
from app.services.fx_conversion import MissingFxRateError, convert_to_inr

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = structlog.get_logger(__name__)

_MATCHED_TOLERANCE = Decimal("100")  # ₹100 tolerance for reconciliation

# Snapshots that produce invoice_snapshot rows. CREDIT_PERIOD publish writes
# only credit_period_config rows (ADR-0005), so it must not be chosen as the
# "latest published snapshot" when the dashboard is aggregating ageing.
_INVOICE_SOURCE_HINTS = ("TALLY", "XERO")


def _resolve_snapshot(
    entity_code: str,
    as_of: str,
    db: Session,
) -> Snapshot:
    """Resolve the target PUBLISHED snapshot.

    as_of='latest' → most recent PUBLISHED snapshot for the entity.
    as_of='YYYY-MM-DD' → PUBLISHED snapshot with that exact as_of_date.

    For entity='ALL': pick the most recent PUBLISHED snapshot across IND+UAE
    (takes the IND snapshot's as_of_date as the reference — same date is
    assumed for UAE in a correctly run workflow).
    """
    if entity_code == "ALL":
        # For ALL: use most-recent PUBLISHED snapshot date across both entities
        # We'll resolve individual entity snapshots during aggregation.
        # Return the most-recent PUBLISHED snapshot of either entity as reference.
        latest = db.scalar(
            select(Snapshot)
            .join(Entity, Snapshot.entity_id == Entity.id)
            .where(
                Entity.code.in_(["IND", "UAE"]),
                Snapshot.status == "PUBLISHED",
                Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
            )
            .order_by(Snapshot.as_of_date.desc(), Snapshot.published_at.desc())
            .limit(1)
        )
        if latest is None:
            raise HTTPException(
                status_code=404,
                detail="No published invoice snapshots (TALLY/XERO) found for any entity.",
            )
        return latest

    # Single entity
    entity = db.scalar(select(Entity).where(Entity.code == entity_code))
    if entity is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_code}' not found.")

    if as_of == "latest":
        snapshot = db.scalar(
            select(Snapshot)
            .where(
                Snapshot.entity_id == entity.id,
                Snapshot.status == "PUBLISHED",
                Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
                Snapshot.as_of_date.is_not(None),
            )
            .order_by(Snapshot.as_of_date.desc(), Snapshot.published_at.desc())
            .limit(1)
        )
        if snapshot is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No published invoice snapshots (TALLY/XERO) found for "
                    f"entity '{entity_code}'."
                ),
            )
        return snapshot

    # Specific date
    try:
        target_date = date.fromisoformat(as_of)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid as_of date format '{as_of}'. Expected YYYY-MM-DD or 'latest'.",
        ) from None

    snapshot = db.scalar(
        select(Snapshot)
        .where(
            Snapshot.entity_id == entity.id,
            Snapshot.status == "PUBLISHED",
            Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
            Snapshot.as_of_date == target_date,
        )
        .limit(1)
    )
    if snapshot is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No published invoice snapshot (TALLY/XERO) found for entity "
                f"'{entity_code}' with as_of_date={as_of}."
            ),
        )
    return snapshot


def _lookup_fx_row(
    from_ccy: str,
    to_ccy: str,
    invoice_date: date,
    db: Session,
) -> FxRate | None:
    """Return the full FxRate row (rate + effective_from) for the given pair and date.

    Mirrors the lookup logic in fx_conversion.lookup_rate but returns the
    entire ORM row so callers can read effective_from for tooltip rendering.
    """
    if from_ccy == to_ccy:
        return None
    return db.scalar(
        select(FxRate)
        .where(
            FxRate.from_ccy == from_ccy,
            FxRate.to_ccy == to_ccy,
            FxRate.effective_from <= invoice_date,
        )
        .order_by(FxRate.effective_from.desc())
        .limit(1)
    )


def _get_snapshot_for_entity(
    entity_id: str,
    as_of_date: date,
    db: Session,
) -> Snapshot | None:
    """Get the PUBLISHED invoice snapshot for an entity nearest to as_of_date."""
    return db.scalar(
        select(Snapshot)
        .where(
            Snapshot.entity_id == entity_id,
            Snapshot.status == "PUBLISHED",
            Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
            Snapshot.as_of_date == as_of_date,
        )
        .limit(1)
    )


def _aggregate_single_entity(
    snapshot: Snapshot,
    entity: Entity,
    db: Session,
    convert_to_inr_flag: bool = False,
) -> tuple[
    dict[str, Decimal],  # ageing_buckets
    list[dict],  # invoice rows for top-party calc
    Decimal,  # total_outstanding
    int,  # parties_on_default_count
]:
    """Aggregate invoice_snapshots for a single entity snapshot.

    Returns:
        ageing_buckets: {bucket: total_outstanding}
        invoice_rows: [{canonical_id, outstanding, bucket, currency, invoice_date}, ...]
        total_outstanding: sum of all outstanding in target currency
        parties_on_default_count: distinct canonical_ids with credit_days_source='DEFAULT'
    """
    # Fetch all invoice_snapshot rows for this snapshot
    snap_rows = db.execute(
        select(
            InvoiceSnapshot.bucket,
            InvoiceSnapshot.outstanding_amount,
            InvoiceSnapshot.invoice_id,
            Invoice.canonical_id,
            Invoice.currency,
            Invoice.invoice_date,
            Invoice.credit_days_source,
            Invoice.raw_row_json,
        )
        .join(Invoice, InvoiceSnapshot.invoice_id == Invoice.id)
        .where(
            InvoiceSnapshot.snapshot_id == snapshot.id,
            InvoiceSnapshot.as_of_date == snapshot.as_of_date,
        )
    ).all()

    ageing_buckets: dict[str, Decimal] = {
        "NOT_DUE": Decimal("0"),
        "0_30": Decimal("0"),
        "31_60": Decimal("0"),
        "61_90": Decimal("0"),
        "90_PLUS": Decimal("0"),
    }
    invoice_rows: list[dict] = []
    total_outstanding = Decimal("0")
    default_canonical_ids: set = set()

    for row in snap_rows:
        amount = row.outstanding_amount
        if convert_to_inr_flag and row.currency != "INR":
            try:
                amount = convert_to_inr(
                    amount=row.outstanding_amount,
                    source_currency=row.currency,
                    invoice_date=row.invoice_date,
                    db=db,
                )
            except MissingFxRateError as e:
                raise e.to_http_422() from e

        bucket = row.bucket
        ageing_buckets[bucket] = ageing_buckets.get(bucket, Decimal("0")) + amount
        total_outstanding += amount

        invoice_rows.append(
            {
                "canonical_id": row.canonical_id,
                "outstanding": amount,
                "bucket": bucket,
                "raw_row_json": row.raw_row_json or {},
            }
        )

        if row.credit_days_source == "DEFAULT":
            default_canonical_ids.add(row.canonical_id)

    return ageing_buckets, invoice_rows, total_outstanding, len(default_canonical_ids)


def _compute_top_parties(
    invoice_rows: list[dict],
    db: Session,
) -> list[TopPartyRow]:
    """Compute top 10 parties by outstanding, with worst bucket, exception count,
    and max Tally overdue_days (spec §13 #4)."""
    from collections import defaultdict

    party_outstanding: dict = defaultdict(Decimal)
    party_buckets: dict = {}
    party_tally_overdue_max: dict = {}  # canonical_id -> max int overdue_days from raw_row_json
    bucket_order = {"90_PLUS": 5, "61_90": 4, "31_60": 3, "0_30": 2, "NOT_DUE": 1}

    for row in invoice_rows:
        cid = row["canonical_id"]
        party_outstanding[cid] += row["outstanding"]
        current_worst = party_buckets.get(cid, "NOT_DUE")
        new_bucket = row["bucket"]
        if bucket_order.get(new_bucket, 0) > bucket_order.get(current_worst, 0):
            party_buckets[cid] = new_bucket

        # Extract Tally overdue_days from raw_row_json (None-safe)
        raw_json: dict = row.get("raw_row_json") or {}
        tally_overdue_raw = raw_json.get("overdue_days")
        if tally_overdue_raw is not None:
            try:
                tally_overdue_int = int(tally_overdue_raw)
            except (ValueError, TypeError):
                tally_overdue_int = None
            if tally_overdue_int is not None:
                current_max = party_tally_overdue_max.get(cid)
                if current_max is None or tally_overdue_int > current_max:
                    party_tally_overdue_max[cid] = tally_overdue_int

    # Sort by outstanding descending, take top 10
    sorted_parties = sorted(party_outstanding.items(), key=lambda x: x[1], reverse=True)[:10]

    results: list[TopPartyRow] = []
    for canonical_id, outstanding in sorted_parties:
        # Fetch canonical name
        canonical = db.get(PartyCanonical, canonical_id)
        canonical_name = canonical.name if canonical else str(canonical_id)

        # Count active exceptions
        exception_count = (
            db.scalar(
                select(func.count(ExceptionTag.id)).where(
                    ExceptionTag.invoice_id.in_(
                        select(Invoice.id).where(Invoice.canonical_id == canonical_id)
                    ),
                    ExceptionTag.status == "ACTIVE",
                )
            )
            or 0
        )

        # Fetch the most-recent follow-up for this canonical
        last_fu = db.execute(
            select(FollowUp.date, FollowUp.channel)
            .where(FollowUp.canonical_id == canonical_id)
            .order_by(FollowUp.date.desc())
            .limit(1)
        ).first()

        results.append(
            TopPartyRow(
                canonical_id=canonical_id,
                canonical_name=canonical_name,
                outstanding=outstanding,
                overdue_bucket=party_buckets.get(canonical_id, "NOT_DUE"),
                active_exception_count=exception_count,
                tally_overdue_days_max=party_tally_overdue_max.get(canonical_id),
                last_follow_up_date=last_fu.date if last_fu else None,
                last_follow_up_channel=last_fu.channel if last_fu else None,
            )
        )

    return results


def _get_recent_exceptions(
    snapshot: Snapshot,
    db: Session,
) -> list[RecentExceptionRow]:
    """Fetch last 5 ACTIVE exception tags for invoices in this snapshot."""
    rows = db.execute(
        select(
            ExceptionTag.id,
            ExceptionTag.invoice_id,
            ExceptionTag.tagged_at,
            ExceptionTag.expected_resolution_date,
            ExceptionBucketType.code.label("bucket_code"),
            ExceptionBucketType.name.label("bucket_name"),
            Invoice.invoice_ref,
            PartyCanonical.name.label("canonical_name"),
            User.email.label("tagged_by_email"),
        )
        .join(ExceptionBucketType, ExceptionTag.bucket_type_id == ExceptionBucketType.id)
        .join(Invoice, ExceptionTag.invoice_id == Invoice.id)
        .join(PartyCanonical, Invoice.canonical_id == PartyCanonical.id)
        .join(User, ExceptionTag.tagged_by == User.id)
        .where(
            Invoice.entity_id == snapshot.entity_id,
            ExceptionTag.status == "ACTIVE",
        )
        .order_by(ExceptionTag.tagged_at.desc())
        .limit(5)
    ).all()

    return [
        RecentExceptionRow(
            exception_id=r.id,
            invoice_id=r.invoice_id,
            invoice_ref=r.invoice_ref,
            canonical_name=r.canonical_name,
            bucket_type_code=r.bucket_code,
            bucket_type_name=r.bucket_name,
            tagged_at=r.tagged_at,
            expected_resolution_date=r.expected_resolution_date,
        )
        for r in rows
    ]


def _get_trend_weekly(
    entity_ids: list,
    db: Session,
    convert_uae_to_inr: bool = False,
) -> list[DashboardTrendRow]:
    """Return last ≤8 weekly trend rows for the given entity_ids.

    Algorithm:
    - Bucket snapshots by ISO week (date_trunc('week', as_of_date)).
    - Pick the latest as_of_date per week (DISTINCT ON).
    - For each chosen snapshot_id, sum outstanding_amount (total) and
      sum outstanding_amount WHERE bucket='90_PLUS'.
    - For entity=ALL (convert_uae_to_inr=True), UAE invoices are converted
      to INR using per-invoice FX rates.  If any FX rate is missing the row
      is silently skipped (trend is best-effort; KPI endpoint enforces hard 422).
    - Returns rows sorted by week_start ascending, limited to 8.
    """
    if not entity_ids:
        return []

    # Step 1: find the latest snapshot per week for the given entities.
    # Raw SQL via text() to leverage date_trunc + DISTINCT ON (Postgres-specific).
    distinct_sql = text(
        """
        SELECT DISTINCT ON (date_trunc('week', s.as_of_date))
            s.id                                  AS snapshot_id,
            s.entity_id,
            s.as_of_date,
            date_trunc('week', s.as_of_date)::date AS week_start
        FROM snapshots s
        WHERE s.entity_id = ANY(:entity_ids)
          AND s.status    = 'PUBLISHED'
          AND s.source_hint IN ('TALLY', 'XERO')
          AND s.as_of_date IS NOT NULL
        ORDER BY date_trunc('week', s.as_of_date) DESC,
                 s.as_of_date DESC,
                 s.published_at DESC
        LIMIT 8
        """
    )
    rows = db.execute(distinct_sql, {"entity_ids": entity_ids}).all()

    if not rows:
        return []

    # Step 2: for each chosen snapshot, aggregate invoice_snapshots.
    trend_rows: list[DashboardTrendRow] = []

    for row in rows:
        snapshot_id = row.snapshot_id
        week_start = row.week_start
        as_of_date = row.as_of_date

        # Fetch invoice_snapshot rows for this snapshot
        inv_rows = db.execute(
            select(
                InvoiceSnapshot.outstanding_amount,
                InvoiceSnapshot.bucket,
                Invoice.currency,
                Invoice.invoice_date,
            )
            .join(Invoice, InvoiceSnapshot.invoice_id == Invoice.id)
            .where(
                InvoiceSnapshot.snapshot_id == snapshot_id,
                InvoiceSnapshot.as_of_date == as_of_date,
            )
        ).all()

        total = Decimal("0")
        ninety_plus = Decimal("0")
        skip = False

        for ir in inv_rows:
            amount = ir.outstanding_amount
            if convert_uae_to_inr and ir.currency != "INR":
                try:
                    amount = convert_to_inr(
                        amount=ir.outstanding_amount,
                        source_currency=ir.currency,
                        invoice_date=ir.invoice_date,
                        db=db,
                    )
                except MissingFxRateError:
                    # Skip this week's row entirely if FX is missing
                    skip = True
                    break
            total += amount
            if ir.bucket == "90_PLUS":
                ninety_plus += amount

        if skip:
            continue

        trend_rows.append(
            DashboardTrendRow(
                week_start=week_start,
                total_outstanding=total,
                ninety_plus=ninety_plus,
            )
        )

    # Sort ascending by week_start (DISTINCT ON returned DESC)
    trend_rows.sort(key=lambda r: r.week_start)
    return trend_rows


def get_dashboard(
    entity: Literal["IND", "UAE", "ALL"],
    as_of: str,
    db: Session,
) -> DashboardResponse:
    """Compute dashboard aggregates for entity at the given as_of date.

    Parameters
    ----------
    entity:  'IND', 'UAE', or 'ALL' (consolidated)
    as_of:   'latest' or 'YYYY-MM-DD'
    db:      SQLAlchemy session

    Raises
    ------
    HTTPException 404: no published snapshot found
    HTTPException 422: missing FX rate for consolidated view
    """
    if entity == "ALL":
        return _get_consolidated_dashboard(as_of, db)
    return _get_single_entity_dashboard(entity, as_of, db)


def _get_single_entity_dashboard(
    entity_code: Literal["IND", "UAE"],
    as_of: str,
    db: Session,
) -> DashboardResponse:
    """Dashboard for a single entity (IND or UAE)."""
    snapshot = _resolve_snapshot(entity_code, as_of, db)
    entity = db.get(Entity, snapshot.entity_id)
    assert entity is not None

    ageing_buckets, invoice_rows, total_outstanding, default_count = _aggregate_single_entity(
        snapshot, entity, db, convert_to_inr_flag=False
    )

    # KPIs
    overdue_total = sum(v for k, v in ageing_buckets.items() if k != "NOT_DUE")
    pct_overdue = (
        (overdue_total / total_outstanding * 100).quantize(Decimal("0.01"))
        if total_outstanding > 0
        else Decimal("0")
    )

    # Count parties with 90+ outstanding
    parties_90plus = len({r["canonical_id"] for r in invoice_rows if r["bucket"] == "90_PLUS"})

    top_parties = _compute_top_parties(invoice_rows, db)
    recent_exceptions = _get_recent_exceptions(snapshot, db)

    currency_display: Literal["INR", "AED"] = "INR" if entity_code == "IND" else "AED"

    trend_weekly = _get_trend_weekly([entity.id], db, convert_uae_to_inr=False)

    return DashboardResponse(
        entity=entity_code,
        as_of_date=snapshot.as_of_date,
        snapshot_id=snapshot.id,
        snapshot_status=snapshot.status,
        currency_display=currency_display,
        kpis=DashboardKPIs(
            total_outstanding=total_outstanding,
            pct_overdue=pct_overdue,
            parties_with_90plus_count=parties_90plus,
            last_snapshot_date=snapshot.as_of_date,
            fx_rate_used=None,
        ),
        ageing_buckets=ageing_buckets,
        top_parties=top_parties,
        recent_exceptions=recent_exceptions,
        parties_on_default_credit_period_count=default_count,
        trend_weekly=trend_weekly,
    )


def _get_consolidated_dashboard(
    as_of: str,
    db: Session,
) -> DashboardResponse:
    """Consolidated dashboard (entity=ALL) — converts AED→INR per invoice."""
    # Resolve the reference snapshot (most recent published across both entities)
    ref_snapshot = _resolve_snapshot("ALL", as_of, db)
    ref_as_of_date: date = ref_snapshot.as_of_date

    # Resolve snapshots for each entity at the same as_of_date
    ind_entity = db.scalar(select(Entity).where(Entity.code == "IND"))
    uae_entity = db.scalar(select(Entity).where(Entity.code == "UAE"))

    combined_buckets: dict[str, Decimal] = {
        "NOT_DUE": Decimal("0"),
        "0_30": Decimal("0"),
        "31_60": Decimal("0"),
        "61_90": Decimal("0"),
        "90_PLUS": Decimal("0"),
    }
    all_invoice_rows: list[dict] = []
    total_outstanding = Decimal("0")
    default_count = 0
    last_fx_rate: Decimal | None = None
    last_fx_rate_row: FxRate | None = None

    for entity in [e for e in [ind_entity, uae_entity] if e is not None]:
        # Find the PUBLISHED snapshot for this entity at ref_as_of_date
        snap = db.scalar(
            select(Snapshot)
            .where(
                Snapshot.entity_id == entity.id,
                Snapshot.status == "PUBLISHED",
                Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
                Snapshot.as_of_date == ref_as_of_date,
            )
            .limit(1)
        )
        if snap is None:
            # Try the most recent published invoice snapshot as fallback
            snap = db.scalar(
                select(Snapshot)
                .where(
                    Snapshot.entity_id == entity.id,
                    Snapshot.status == "PUBLISHED",
                    Snapshot.source_hint.in_(_INVOICE_SOURCE_HINTS),
                )
                .order_by(Snapshot.as_of_date.desc())
                .limit(1)
            )
        if snap is None:
            continue

        convert = entity.code == "UAE"
        try:
            buckets, rows, total, d_count = _aggregate_single_entity(
                snap, entity, db, convert_to_inr_flag=convert
            )
        except HTTPException:
            raise

        for k, v in buckets.items():
            combined_buckets[k] = combined_buckets.get(k, Decimal("0")) + v
        all_invoice_rows.extend(rows)
        total_outstanding += total
        default_count += d_count

        # Capture a representative FX rate row for tooltip display
        if convert and rows:
            fx_row = _lookup_fx_row("AED", "INR", ref_as_of_date, db)
            if fx_row is not None:
                last_fx_rate = fx_row.rate
                last_fx_rate_row = fx_row

    overdue_total = sum(v for k, v in combined_buckets.items() if k != "NOT_DUE")
    pct_overdue = (
        (overdue_total / total_outstanding * 100).quantize(Decimal("0.01"))
        if total_outstanding > 0
        else Decimal("0")
    )
    parties_90plus = len({r["canonical_id"] for r in all_invoice_rows if r["bucket"] == "90_PLUS"})

    top_parties = _compute_top_parties(all_invoice_rows, db)

    # Recent exceptions across all entities — use ref_snapshot
    recent_exceptions = _get_recent_exceptions(ref_snapshot, db)

    # Trend: collect entity_ids for IND + UAE, convert UAE→INR
    all_entity_ids = [e.id for e in [ind_entity, uae_entity] if e is not None]
    trend_weekly = _get_trend_weekly(all_entity_ids, db, convert_uae_to_inr=True)

    return DashboardResponse(
        entity="ALL",
        as_of_date=ref_as_of_date,
        snapshot_id=ref_snapshot.id,
        snapshot_status=ref_snapshot.status,
        currency_display="INR",
        kpis=DashboardKPIs(
            total_outstanding=total_outstanding,
            pct_overdue=pct_overdue,
            parties_with_90plus_count=parties_90plus,
            last_snapshot_date=ref_as_of_date,
            fx_rate_used=last_fx_rate,
            fx_rate_effective_from=last_fx_rate_row.effective_from if last_fx_rate_row else None,
            fx_rate_from_ccy="AED" if last_fx_rate_row else None,
            fx_rate_to_ccy="INR" if last_fx_rate_row else None,
        ),
        ageing_buckets=combined_buckets,
        top_parties=top_parties,
        recent_exceptions=recent_exceptions,
        parties_on_default_credit_period_count=default_count,
        trend_weekly=trend_weekly,
    )
