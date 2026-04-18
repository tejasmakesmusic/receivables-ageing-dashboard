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
from sqlalchemy import func, select

from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User
from app.schemas.dashboard import (
    DashboardKPIs,
    DashboardResponse,
    RecentExceptionRow,
    TopPartyRow,
)
from app.services.fx_conversion import MissingFxRateError, convert_to_inr, lookup_rate

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = structlog.get_logger(__name__)

_MATCHED_TOLERANCE = Decimal("100")  # ₹100 tolerance for reconciliation


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
            )
            .order_by(Snapshot.as_of_date.desc(), Snapshot.published_at.desc())
            .limit(1)
        )
        if latest is None:
            raise HTTPException(
                status_code=404,
                detail="No published snapshots found for any entity.",
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
                Snapshot.as_of_date.is_not(None),
            )
            .order_by(Snapshot.as_of_date.desc(), Snapshot.published_at.desc())
            .limit(1)
        )
        if snapshot is None:
            raise HTTPException(
                status_code=404,
                detail=f"No published snapshots found for entity '{entity_code}'.",
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
            Snapshot.as_of_date == target_date,
        )
        .limit(1)
    )
    if snapshot is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No published snapshot found for entity '{entity_code}' "
                f"with as_of_date={as_of}."
            ),
        )
    return snapshot


def _get_snapshot_for_entity(
    entity_id: str,
    as_of_date: date,
    db: Session,
) -> Snapshot | None:
    """Get the PUBLISHED snapshot for a specific entity nearest to as_of_date."""
    return db.scalar(
        select(Snapshot)
        .where(
            Snapshot.entity_id == entity_id,
            Snapshot.status == "PUBLISHED",
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
            }
        )

        if row.credit_days_source == "DEFAULT":
            default_canonical_ids.add(row.canonical_id)

    return ageing_buckets, invoice_rows, total_outstanding, len(default_canonical_ids)


def _compute_top_parties(
    invoice_rows: list[dict],
    db: Session,
) -> list[TopPartyRow]:
    """Compute top 10 parties by outstanding, with worst bucket and exception count."""
    from collections import defaultdict

    party_outstanding: dict = defaultdict(Decimal)
    party_buckets: dict = {}
    bucket_order = {"90_PLUS": 5, "61_90": 4, "31_60": 3, "0_30": 2, "NOT_DUE": 1}

    for row in invoice_rows:
        cid = row["canonical_id"]
        party_outstanding[cid] += row["outstanding"]
        current_worst = party_buckets.get(cid, "NOT_DUE")
        new_bucket = row["bucket"]
        if bucket_order.get(new_bucket, 0) > bucket_order.get(current_worst, 0):
            party_buckets[cid] = new_bucket

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

        results.append(
            TopPartyRow(
                canonical_id=canonical_id,
                canonical_name=canonical_name,
                outstanding=outstanding,
                overdue_bucket=party_buckets.get(canonical_id, "NOT_DUE"),
                active_exception_count=exception_count,
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

    for entity in [e for e in [ind_entity, uae_entity] if e is not None]:
        # Find the PUBLISHED snapshot for this entity at ref_as_of_date
        snap = db.scalar(
            select(Snapshot)
            .where(
                Snapshot.entity_id == entity.id,
                Snapshot.status == "PUBLISHED",
                Snapshot.as_of_date == ref_as_of_date,
            )
            .limit(1)
        )
        if snap is None:
            # Try the most recent published snapshot as fallback
            snap = db.scalar(
                select(Snapshot)
                .where(
                    Snapshot.entity_id == entity.id,
                    Snapshot.status == "PUBLISHED",
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

        # Capture a representative FX rate for display (use latest UAE invoice date)
        if convert and rows:
            # Get a sample rate using the ref_as_of_date as proxy
            sample_rate = lookup_rate("AED", "INR", ref_as_of_date, db)
            if sample_rate:
                last_fx_rate = sample_rate

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
        ),
        ageing_buckets=combined_buckets,
        top_parties=top_parties,
        recent_exceptions=recent_exceptions,
        parties_on_default_credit_period_count=default_count,
    )
