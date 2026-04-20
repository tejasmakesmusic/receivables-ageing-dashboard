"""Snapshot upload orchestration service (M3 Task 2, spec §5 + §10).

Public interface::

    upload_snapshot(
        db: Session,
        file_bytes: bytes,
        entity_code: str,
        source_hint: str | None,
        as_of_date_form: date | None,
        current_user: User,
        request_ip: str,
    ) -> SnapshotCreateResponse

All business logic lives here; the route handler is a thin adapter.

Guardrails (CLAUDE.md):
- No datetime.today() / datetime.now() for computed values.
- No print statements — structlog only, aggregate counts, no raw names.
- Every DB mutation writes an audit_log row.
- Parser PARSE_ERROR rows (row-level) do NOT block staging; only file-level
  errors (ParseResult.errors) block snapshot creation.
"""

from __future__ import annotations

import io
import re
from datetime import UTC, date, datetime  # noqa: TCH003 — used at runtime in function signatures
from typing import TYPE_CHECKING

import openpyxl
import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models.audit_log import AuditLog
from app.db.models.entity import Entity
from app.db.models.snapshot import Snapshot
from app.parsers.common import ParseResult, compute_file_sha256
from app.parsers.credit_period import parse_credit_period_master
from app.parsers.tally import parse_tally_grpbills
from app.parsers.xero import parse_xero_aged_receivables
from app.schemas.snapshot import (
    ParseSummary,
    SnapshotCreateResponse,
    WarningItem,
)
from app.services.partition_check import invoice_snapshots_has_partition_for
from app.services.source_detect import (
    AmbiguousSourceError,
    SourceHint,
    detect_source_from_xlsx,
    validate_source_hint_against_file,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.db.models.user import User

log = structlog.get_logger(__name__)

# Xero "As at DD Month YYYY" regex — mirrors the parser's own sniff.
_AS_OF_RE = re.compile(
    r"as\s+at\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_entity(db: Session, entity_code: str) -> Entity:
    """Look up entity by code; raise 400 if not found."""
    entity = db.scalar(select(Entity).where(Entity.code == entity_code))
    if entity is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown entity_code: {entity_code!r}.",
        )
    return entity


def _check_entity_scope(current_user: User, entity: Entity) -> None:
    """Enforce ANALYST entity scope.  ADMIN bypasses.  CFO/PENDING blocked at route."""
    from app.core.rbac import Role

    if current_user.role == Role.ADMIN:
        return
    # ANALYST: must have entity_id_scope == entity.id OR entity_id_scope IS NULL (unusual).
    if current_user.entity_id_scope is not None and current_user.entity_id_scope != entity.id:
        raise HTTPException(
            status_code=403,
            detail="Analyst scope does not include this entity.",
        )


def _check_duplicate(db: Session, sha256: str) -> None:
    """Raise 409 if file_sha256 already exists in snapshots."""
    existing = db.scalar(select(Snapshot).where(Snapshot.upload_file_sha256 == sha256))
    if existing is not None:
        from app.schemas.snapshot import DuplicateFileError

        raise HTTPException(
            status_code=409,
            detail=DuplicateFileError(
                file_sha256=sha256,
                existing_snapshot_id=str(existing.id),
            ).model_dump(),
        )


def _detect_or_validate_source(
    file_bytes: bytes,
    caller_hint: str | None,
) -> SourceHint:
    """Resolve the effective source_hint from caller + file sheet names.

    Returns the validated/detected SourceHint.
    Raises HTTPException 400 on ambiguity, unknown hint, or mismatch.
    """
    valid_hints: set[SourceHint] = {"TALLY", "XERO", "CREDIT_PERIOD"}

    if caller_hint is not None:
        caller_upper = caller_hint.upper()
        if caller_upper not in valid_hints:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown source_hint: {caller_hint!r}. Must be one of TALLY, XERO, CREDIT_PERIOD.",
            )
        hint: SourceHint = caller_upper  # guarded by set membership above
        # Validate that file sheet names agree.
        try:
            validate_source_hint_against_file(file_bytes, hint)
        except AmbiguousSourceError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return hint

    # Auto-detect.
    try:
        detected = detect_source_from_xlsx(file_bytes)
    except AmbiguousSourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot read XLSX file for source detection: {exc}",
        ) from exc

    if detected is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot auto-detect source: file sheet names do not match any known "
                "format (TALLY='Sundry Debtors', XERO='Aged Receivables Detail', "
                "CREDIT_PERIOD='India'+'UAE'). Supply source_hint explicitly."
            ),
        )
    return detected


def _sniff_xero_as_of_date(file_bytes: bytes) -> date | None:
    """Peek at Xero file row 2 (0-indexed) to sniff the as-of date.

    Uses openpyxl read_only to avoid loading the full workbook.
    Returns date on success, None on failure.
    """
    try:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        if ws is None:
            wb.close()
            return None
        # Read the first 3 rows to reach row 2 (0-indexed = row 3 in 1-indexed openpyxl).
        rows = list(ws.iter_rows(min_row=3, max_row=3, values_only=True))
        wb.close()
        if not rows or not rows[0]:
            return None
        cell_val = rows[0][0]
        if not isinstance(cell_val, str):
            return None
        m = _AS_OF_RE.search(cell_val)
        if not m:
            return None
        import pandas as pd  # local import to avoid top-level dep on heavy pandas here

        result: date = pd.to_datetime(m.group(1), dayfirst=True).date()
        return result
    except Exception:
        return None


def _resolve_as_of_date_tally(form_value: date | None) -> date:
    """TALLY: form value is required.  Raises 422 if absent."""
    if form_value is None:
        from app.schemas.snapshot import AsOfDateMissingError

        raise HTTPException(
            status_code=422,
            detail=AsOfDateMissingError(
                detail="as_of_date is required for TALLY uploads (Tally files do not embed it)."
            ).model_dump(),
        )
    return form_value


def _resolve_as_of_date_xero(file_bytes: bytes, form_value: date | None) -> date:
    """XERO: sniff from file; fall back to form value.  Raises 422 if both absent."""
    sniffed = _sniff_xero_as_of_date(file_bytes)

    if sniffed is not None and form_value is not None and sniffed != form_value:
        log.info(
            "snapshot_service.xero_as_of_date_override",
            sniffed=str(sniffed),
            form_value=str(form_value),
            winner="sniffed",
        )

    if sniffed is not None:
        return sniffed

    if form_value is not None:
        return form_value

    from app.schemas.snapshot import AsOfDateMissingError

    raise HTTPException(
        status_code=422,
        detail=AsOfDateMissingError(
            detail=(
                "as_of_date could not be sniffed from the Xero file (row 3 did not match "
                "'As at DD Month YYYY' format) and was not supplied in the form."
            )
        ).model_dump(),
    )


def _preflight_partition(db: Session, effective_date: date, source: SourceHint) -> None:
    """Check that invoice_snapshots has a partition covering effective_date.

    Only applies to TALLY and XERO.  CREDIT_PERIOD skips (no invoice rows land
    in invoice_snapshots for CP imports).
    """
    if source == "CREDIT_PERIOD":
        return

    if not invoice_snapshots_has_partition_for(db, effective_date):
        from app.schemas.snapshot import MissingPartitionError

        raise HTTPException(
            status_code=422,
            detail=MissingPartitionError(as_of_date=effective_date).model_dump(mode="json"),
        )


def _dispatch_parser(source: SourceHint, file_bytes: bytes) -> ParseResult:
    """Call the appropriate parser.  File-level errors propagate as-is."""
    if source == "TALLY":
        return parse_tally_grpbills(file_bytes)
    if source == "XERO":
        return parse_xero_aged_receivables(file_bytes)
    return parse_credit_period_master(file_bytes)


def _build_parse_summary(result: ParseResult) -> ParseSummary:
    """Convert ParseResult to the public ParseSummary shape."""
    parse_error_count = sum(1 for inv in result.invoices if inv.status.value == "PARSE_ERROR")
    warnings = [
        WarningItem(
            code=w.code,
            message=w.message,
            detail=w.detail,
        )
        for w in result.warnings
    ]
    return ParseSummary(
        invoices_parsed=len(result.invoices),
        credit_periods_parsed=len(result.credit_periods),
        parse_error_count=parse_error_count,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def upload_snapshot(
    db: Session,
    file_bytes: bytes,
    entity_code: str,
    source_hint_form: str | None,
    as_of_date_form: date | None,
    current_user: User,
    request_ip: str,
) -> SnapshotCreateResponse:
    """Orchestrate the upload flow (spec §5 STAGED entry, §10 POST /snapshots).

    Returns:
        SnapshotCreateResponse on success.

    Raises:
        HTTPException 400: malformed input, unknown/ambiguous source.
        HTTPException 403: entity scope violation.
        HTTPException 409: duplicate file.
        HTTPException 422: missing partition, missing as_of_date, file-level parse errors.
        HTTPException 500: unexpected parser crash (re-raised).
    """
    # 1. Resolve entity.
    entity = _resolve_entity(db, entity_code)

    # 2. Verify entity scope.
    _check_entity_scope(current_user, entity)

    # 3. Compute sha256 + duplicate check.
    sha256 = compute_file_sha256(file_bytes)
    _check_duplicate(db, sha256)

    # 4. Detect / validate source_hint.
    source: SourceHint = _detect_or_validate_source(file_bytes, source_hint_form)

    # 5. Resolve effective as_of_date.
    effective_date: date | None
    if source == "TALLY":
        effective_date = _resolve_as_of_date_tally(as_of_date_form)
    elif source == "XERO":
        effective_date = _resolve_as_of_date_xero(file_bytes, as_of_date_form)
    else:
        # CREDIT_PERIOD: the master has no natural date embedded in the sheet.
        # Accept a form value if provided (sets valid_from on config rows per
        # ADR-0005 D2); otherwise default to today UTC so publish doesn't 422.
        effective_date = as_of_date_form if as_of_date_form is not None else datetime.now(tz=UTC).date()

    # 6. Partition pre-flight (TALLY + XERO only).
    if effective_date is not None:
        _preflight_partition(db, effective_date, source)

    # 7. Dispatch parser.
    try:
        result = _dispatch_parser(source, file_bytes)
    except Exception as exc:
        log.error(
            "snapshot_service.parser_crash",
            source=source,
            error=str(exc),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Parser raised an unexpected error: {type(exc).__name__}",
        ) from exc

    # 8. Reject on file-level parse errors (block snapshot creation).
    if result.errors:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "PARSE_ERROR",
                "errors": [e.model_dump() for e in result.errors],
            },
        )

    # 9. Create snapshot row.
    snapshot = Snapshot(
        entity_id=entity.id,
        uploaded_by=current_user.id,
        as_of_date=effective_date,
        source_hint=source,
        status="STAGED",
        upload_file_sha256=sha256,
        parse_result_json=result.model_dump(mode="json"),
    )
    db.add(snapshot)

    try:
        db.flush()  # get snapshot.id without committing — audit_log needs it
    except IntegrityError as exc:
        db.rollback()
        # Race condition: another request inserted the same sha256 between our
        # select-check and this insert.  Surface as 409.
        if "uq_snapshots_upload_file_sha256" in str(exc):
            existing = db.scalar(select(Snapshot).where(Snapshot.upload_file_sha256 == sha256))
            from app.schemas.snapshot import DuplicateFileError

            raise HTTPException(
                status_code=409,
                detail=DuplicateFileError(
                    file_sha256=sha256,
                    existing_snapshot_id=str(existing.id) if existing else "unknown",
                ).model_dump(),
            ) from exc
        raise

    # 10. Emit audit_log row.
    audit = AuditLog(
        action="snapshot.upload",
        entity_type="snapshots",
        entity_id=snapshot.id,
        actor_user_id=current_user.id,
        before={},
        after={
            "source_hint": source,
            "entity_id": str(entity.id),
            "file_sha256": sha256,
            "as_of_date": str(effective_date) if effective_date else None,
        },
    )
    db.add(audit)
    db.commit()
    db.refresh(snapshot)

    log.info(
        "snapshot_service.uploaded",
        snapshot_id=str(snapshot.id),
        source=source,
        entity_code=entity_code,
        invoices=len(result.invoices),
        credit_periods=len(result.credit_periods),
        parse_errors=sum(1 for i in result.invoices if i.status.value == "PARSE_ERROR"),
        warnings=len(result.warnings),
    )

    return SnapshotCreateResponse(
        snapshot_id=str(snapshot.id),
        status="STAGED",
        source_hint=source,
        as_of_date=effective_date,
        file_sha256=sha256,
        parse_summary=_build_parse_summary(result),
    )
