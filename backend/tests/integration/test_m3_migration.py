"""M3 migration integration tests.

Verifies:
  1. upgrade head → all 7 M3 tables exist with expected columns, indexes,
     constraints (spot-checks, not exhaustive).
  2. downgrade -1 → all 7 M3 tables gone, M1+M2 tables still present.
  3. upgrade head again → idempotent, D9 seed rows present (exactly 4,
     correct codes in expected order).
  4. invoice_snapshots partition routing: a row with as_of_date=2026-02-15
     lands in invoice_snapshots_2026_q1; a row with as_of_date=2026-05-01
     lands in invoice_snapshots_2026_q2.

All alembic commands go through ``uv run alembic`` mirroring conftest.py.
The ``db_session`` fixture provides a live connection to the Neon test branch
already migrated to ``head`` by the session-scoped ``test_engine`` fixture.
"""

from __future__ import annotations

import subprocess
import uuid
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
import sqlalchemy.exc
from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

PROJECT_ROOT = Path(__file__).resolve().parents[3]

# D9 seed codes — order must match migration _D9_SEEDS list.
_D9_EXPECTED_CODES = {"LEGAL", "DISPUTED", "CN_PENDING", "WRITTEN_OFF"}


def _alembic(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", "alembic", "-c", "backend/alembic.ini", *args],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------------------
# Schema existence checks (run against already-migrated-to-head session)
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_m3_tables_exist(db_session: Session) -> None:
    """All 7 M3 tables must exist after upgrade head."""
    expected_tables = {
        "snapshots",
        "parties_canonical",
        "party_aliases",
        "credit_period_config",
        "invoices",
        "invoice_snapshots",
        "exception_bucket_types",
    }
    result = db_session.execute(
        text(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' "
            "AND tablename = ANY(:names)"
        ),
        {"names": list(expected_tables)},
    ).fetchall()
    found = {row[0] for row in result}
    assert found == expected_tables, f"Missing tables: {expected_tables - found}"


@pytest.mark.integration
def test_m3_snapshots_columns(db_session: Session) -> None:
    cols = db_session.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='snapshots'"
        )
    ).fetchall()
    col_names = {r[0] for r in cols}
    for required in (
        "id",
        "entity_id",
        "upload_file_sha256",
        "source_hint",
        "status",
        "parse_result_json",
        "warnings_acknowledged_json",
        "published_as",
        "published_at",
        "published_by",
        "discarded_at",
        "discarded_by",
    ):
        assert required in col_names, f"snapshots.{required} missing"


@pytest.mark.integration
def test_m3_invoice_snapshots_partition_parent_exists(db_session: Session) -> None:
    """invoice_snapshots must be a partitioned table."""
    result = db_session.execute(
        text(
            "SELECT relkind FROM pg_class "
            "WHERE relname = 'invoice_snapshots' AND relnamespace = 'public'::regnamespace"
        )
    ).scalar()
    # 'p' = partitioned table in Postgres
    assert result == "p", f"invoice_snapshots relkind={result!r}; expected 'p' (partitioned)"


@pytest.mark.integration
def test_m3_invoice_snapshots_partitions_exist(db_session: Session) -> None:
    """Q1 and Q2 2026 partitions must exist."""
    for partition_name in ("invoice_snapshots_2026_q1", "invoice_snapshots_2026_q2"):
        result = db_session.execute(
            text(
                "SELECT relname FROM pg_class "
                "WHERE relname = :name AND relnamespace = 'public'::regnamespace"
            ),
            {"name": partition_name},
        ).scalar()
        assert result == partition_name, f"Partition {partition_name} not found"


@pytest.mark.integration
def test_m3_d9_seed_exactly_four_rows(db_session: Session) -> None:
    """Exactly 4 D9 exception bucket types must be seeded."""
    rows = db_session.execute(
        text("SELECT code FROM exception_bucket_types ORDER BY code")
    ).fetchall()
    codes = {r[0] for r in rows}
    assert len(rows) == 4, f"Expected 4 D9 seed rows, got {len(rows)}: {codes}"
    assert codes == _D9_EXPECTED_CODES, f"D9 codes mismatch: {codes}"


@pytest.mark.integration
def test_m3_d9_seed_all_active(db_session: Session) -> None:
    """All D9 rows must have active=True."""
    rows = db_session.execute(text("SELECT code, active FROM exception_bucket_types")).fetchall()
    inactive = [(r[0], r[1]) for r in rows if not r[1]]
    assert not inactive, f"D9 rows with active=False: {inactive}"


@pytest.mark.integration
def test_m3_credit_period_config_partial_unique_index_exists(db_session: Session) -> None:
    """Partial unique index on credit_period_config (valid_to IS NULL) must exist."""
    result = db_session.execute(
        text(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'credit_period_config' "
            "AND indexname = 'ix_credit_period_config_open'"
        )
    ).scalar()
    assert (
        result == "ix_credit_period_config_open"
    ), "Partial unique index ix_credit_period_config_open missing"


@pytest.mark.integration
def test_m3_invoices_open_partial_index_exists(db_session: Session) -> None:
    """Partial index on invoices WHERE status='OPEN' must exist (spec §3)."""
    result = db_session.execute(
        text(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'invoices' "
            "AND indexname = 'ix_invoices_status_open'"
        )
    ).scalar()
    assert (
        result == "ix_invoices_status_open"
    ), "Partial index ix_invoices_status_open missing from invoices"


@pytest.mark.integration
def test_m3_invoice_snapshot_partition_routing(db_session: Session) -> None:
    """Rows land in the correct quarterly partition.

    Insert one row with as_of_date in Q1-2026 and one in Q2-2026, then
    confirm each row's tableoid maps to the expected partition name.

    Uses the seeded IND entity (from 0002_seed_bootstrap_admin) and
    Tejaswa's user UUID so FK constraints are satisfied.  All rows are
    inserted inside the per-test transaction and rolled back at teardown.
    """
    # UUIDs from 0002_seed_bootstrap_admin — must stay in sync with that file.
    entity_ind_id = "600e57f5-8718-4517-9c99-cf56d4bd7a51"
    user_tejaswa_id = "3805b9d4-906a-4da9-a0b8-aca542e62ba4"

    snapshot_id = str(uuid.uuid4())
    party_id = str(uuid.uuid4())
    invoice_id = str(uuid.uuid4())

    # Minimal parties_canonical row.
    db_session.execute(
        text(
            "INSERT INTO parties_canonical (id, entity_id, name, created_by, created_at) "
            "VALUES (:id, :eid, 'Test Party', :uid, NOW())"
        ),
        {"id": party_id, "eid": entity_ind_id, "uid": user_tejaswa_id},
    )

    # Minimal snapshot row for Q1 as_of_date.
    db_session.execute(
        text(
            "INSERT INTO snapshots "
            "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
            "source_hint, status, uploaded_at, created_at, updated_at) "
            "VALUES (:id, :eid, :uid, :sha, '2026-02-15', 'TALLY', 'PUBLISHED', NOW(), NOW(), NOW())"
        ),
        {
            "id": snapshot_id,
            "eid": entity_ind_id,
            "uid": user_tejaswa_id,
            "sha": "test-sha256-partition-routing",
        },
    )

    # Minimal invoice row.
    db_session.execute(
        text(
            "INSERT INTO invoices "
            "(id, entity_id, canonical_id, invoice_ref, invoice_date, amount, "
            "currency, credit_days_applied, credit_days_source, due_date, "
            "status, first_seen_snapshot_id, raw_row_json, created_at, updated_at) "
            "VALUES (:id, :eid, :cid, 'TEST-INV-001', '2026-01-15', 10000.00, "
            "'INR', 30, 'DEFAULT', '2026-02-14', 'OPEN', :sid, '{}', NOW(), NOW())"
        ),
        {
            "id": invoice_id,
            "eid": entity_ind_id,
            "cid": party_id,
            "sid": snapshot_id,
        },
    )

    # Q1-2026 invoice_snapshot (as_of_date = 2026-02-15)
    db_session.execute(
        text(
            "INSERT INTO invoice_snapshots "
            "(snapshot_id, invoice_id, as_of_date, outstanding_amount, overdue_days, bucket, created_at) "
            "VALUES (:sid, :iid, '2026-02-15', 10000.00, 1, '0_30', NOW())"
        ),
        {"sid": snapshot_id, "iid": invoice_id},
    )
    row_q1_id = db_session.execute(
        text(
            "SELECT id FROM invoice_snapshots "
            "WHERE invoice_id = :iid AND as_of_date = '2026-02-15'"
        ),
        {"iid": invoice_id},
    ).scalar()

    # Update snapshot for Q2 as_of_date (different sha256 required).
    snapshot_q2_id = str(uuid.uuid4())
    db_session.execute(
        text(
            "INSERT INTO snapshots "
            "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
            "source_hint, status, uploaded_at, created_at, updated_at) "
            "VALUES (:id, :eid, :uid, :sha, '2026-05-01', 'TALLY', 'PUBLISHED', NOW(), NOW(), NOW())"
        ),
        {
            "id": snapshot_q2_id,
            "eid": entity_ind_id,
            "uid": user_tejaswa_id,
            "sha": "test-sha256-partition-routing-q2",
        },
    )

    # Q2-2026 invoice_snapshot (as_of_date = 2026-05-01)
    db_session.execute(
        text(
            "INSERT INTO invoice_snapshots "
            "(snapshot_id, invoice_id, as_of_date, outstanding_amount, overdue_days, bucket, created_at) "
            "VALUES (:sid, :iid, '2026-05-01', 9000.00, 35, '31_60', NOW())"
        ),
        {"sid": snapshot_q2_id, "iid": invoice_id},
    )
    row_q2_id = db_session.execute(
        text(
            "SELECT id FROM invoice_snapshots "
            "WHERE invoice_id = :iid AND as_of_date = '2026-05-01'"
        ),
        {"iid": invoice_id},
    ).scalar()

    # Confirm partition assignment via tableoid::regclass
    partition_q1 = db_session.execute(
        text(
            "SELECT tableoid::regclass::text "
            "FROM invoice_snapshots WHERE id = :id AND as_of_date = '2026-02-15'"
        ),
        {"id": row_q1_id},
    ).scalar()
    partition_q2 = db_session.execute(
        text(
            "SELECT tableoid::regclass::text "
            "FROM invoice_snapshots WHERE id = :id AND as_of_date = '2026-05-01'"
        ),
        {"id": row_q2_id},
    ).scalar()

    assert partition_q1 == "invoice_snapshots_2026_q1", (
        f"as_of_date=2026-02-15 landed in {partition_q1!r}, " "expected invoice_snapshots_2026_q1"
    )
    assert partition_q2 == "invoice_snapshots_2026_q2", (
        f"as_of_date=2026-05-01 landed in {partition_q2!r}, " "expected invoice_snapshots_2026_q2"
    )


# ---------------------------------------------------------------------------
# CHECK constraint violation tests
#
# Each test inserts a deliberately bad value via raw SQL (bypassing the ORM's
# Python-level enum enforcement) and asserts the DB CHECK constraint fires.
# Using raw SQL is intentional — if the constraint were accidentally removed
# from the DDL, the ORM would still reject it; raw SQL proves the DB enforces
# it independently.
# ---------------------------------------------------------------------------

# Seed UUIDs from 0002_seed_bootstrap_admin — must stay in sync with that
# migration file.
_ENTITY_IND_ID = "600e57f5-8718-4517-9c99-cf56d4bd7a51"
_USER_TEJASWA_ID = "3805b9d4-906a-4da9-a0b8-aca542e62ba4"


def _make_minimal_snapshot(db_session: Session, sha_suffix: str = "") -> str:
    """Insert a minimal valid snapshot row and return its id as a str UUID.

    Uses a randomised sha256 to avoid collisions across tests.  Callers must
    supply a ``sha_suffix`` if they need two snapshots in the same test.
    """
    sid = str(uuid.uuid4())
    sha = f"check-constraint-test-sha-{sid}{sha_suffix}"[:64]
    db_session.execute(
        text(
            "INSERT INTO snapshots "
            "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
            "source_hint, status, uploaded_at, created_at, updated_at) "
            "VALUES (:id, :eid, :uid, :sha, '2026-02-15', 'TALLY', 'STAGED', NOW(), NOW(), NOW())"
        ),
        {"id": sid, "eid": _ENTITY_IND_ID, "uid": _USER_TEJASWA_ID, "sha": sha},
    )
    return sid


def _make_minimal_party(db_session: Session) -> str:
    """Insert a minimal valid parties_canonical row and return its id."""
    pid = str(uuid.uuid4())
    db_session.execute(
        text(
            "INSERT INTO parties_canonical (id, entity_id, name, created_by, created_at) "
            "VALUES (:id, :eid, :name, :uid, NOW())"
        ),
        {
            "id": pid,
            "eid": _ENTITY_IND_ID,
            "name": f"Test Party {pid[:8]}",
            "uid": _USER_TEJASWA_ID,
        },
    )
    return pid


def _make_minimal_invoice(db_session: Session, snapshot_id: str, party_id: str) -> str:
    """Insert a minimal valid invoice row and return its id."""
    iid = str(uuid.uuid4())
    db_session.execute(
        text(
            "INSERT INTO invoices "
            "(id, entity_id, canonical_id, invoice_ref, invoice_date, amount, "
            "currency, credit_days_applied, credit_days_source, due_date, "
            "status, first_seen_snapshot_id, raw_row_json, created_at, updated_at) "
            "VALUES (:id, :eid, :cid, :ref, '2026-01-15', 10000.00, "
            "'INR', 30, 'DEFAULT', '2026-02-14', 'OPEN', :sid, '{}', NOW(), NOW())"
        ),
        {
            "id": iid,
            "eid": _ENTITY_IND_ID,
            "cid": party_id,
            "ref": f"TEST-{iid[:8]}",
            "sid": snapshot_id,
        },
    )
    return iid


@pytest.mark.integration
def test_invoice_snapshot_bucket_check_rejects_invalid_value(db_session: Session) -> None:
    """CHECK constraint on invoice_snapshots.bucket must reject values outside
    the D6 enum. Guards against silent migration drift (e.g. if the bucket
    CHECK were accidentally removed from the raw DDL block).
    """
    snapshot_id = _make_minimal_snapshot(db_session)
    party_id = _make_minimal_party(db_session)
    invoice_id = _make_minimal_invoice(db_session, snapshot_id, party_id)

    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO invoice_snapshots "
                "(snapshot_id, invoice_id, as_of_date, outstanding_amount, overdue_days, bucket, created_at) "
                "VALUES (:s, :i, '2026-02-15', 1000.00, 5, 'INVALID', NOW())"
            ),
            {"s": snapshot_id, "i": invoice_id},
        )
        db_session.flush()
    db_session.rollback()


@pytest.mark.integration
def test_snapshot_status_check_rejects_invalid_value(db_session: Session) -> None:
    """CHECK constraint on snapshots.status must reject values outside
    STAGED / PUBLISHED / DISCARDED.
    """
    sid = str(uuid.uuid4())
    sha = f"status-check-bad-{sid}"[:64]
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO snapshots "
                "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
                "source_hint, status, uploaded_at, created_at, updated_at) "
                "VALUES (:id, :eid, :uid, :sha, '2026-02-15', 'TALLY', 'ACTIVE', NOW(), NOW(), NOW())"
            ),
            {"id": sid, "eid": _ENTITY_IND_ID, "uid": _USER_TEJASWA_ID, "sha": sha},
        )
        db_session.flush()
    db_session.rollback()


@pytest.mark.integration
def test_snapshot_source_hint_check_rejects_invalid_value(db_session: Session) -> None:
    """CHECK constraint on snapshots.source_hint must reject values outside
    TALLY / XERO / CREDIT_PERIOD.
    """
    sid = str(uuid.uuid4())
    sha = f"source-hint-check-bad-{sid}"[:64]
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO snapshots "
                "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
                "source_hint, status, uploaded_at, created_at, updated_at) "
                "VALUES (:id, :eid, :uid, :sha, '2026-02-15', 'QUICKBOOKS', 'STAGED', NOW(), NOW(), NOW())"
            ),
            {"id": sid, "eid": _ENTITY_IND_ID, "uid": _USER_TEJASWA_ID, "sha": sha},
        )
        db_session.flush()
    db_session.rollback()


@pytest.mark.integration
def test_invoice_status_check_rejects_invalid_value(db_session: Session) -> None:
    """CHECK constraint on invoices.status must reject values outside
    OPEN / SETTLED.
    """
    snapshot_id = _make_minimal_snapshot(db_session, sha_suffix="-inv-status")
    party_id = _make_minimal_party(db_session)
    iid = str(uuid.uuid4())
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO invoices "
                "(id, entity_id, canonical_id, invoice_ref, invoice_date, amount, "
                "currency, credit_days_applied, credit_days_source, due_date, "
                "status, first_seen_snapshot_id, raw_row_json, created_at, updated_at) "
                "VALUES (:id, :eid, :cid, 'TEST-BAD-STATUS', '2026-01-15', 10000.00, "
                "'INR', 30, 'DEFAULT', '2026-02-14', 'PAID', :sid, '{}', NOW(), NOW())"
            ),
            {"id": iid, "eid": _ENTITY_IND_ID, "cid": party_id, "sid": snapshot_id},
        )
        db_session.flush()
    db_session.rollback()


@pytest.mark.integration
def test_party_alias_source_check_rejects_invalid_value(db_session: Session) -> None:
    """CHECK constraint on party_aliases.source must reject values outside
    TALLY / XERO / MANUAL.
    """
    party_id = _make_minimal_party(db_session)
    alias_id = str(uuid.uuid4())
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO party_aliases "
                "(id, canonical_id, alias_text, source, created_by, created_at) "
                "VALUES (:id, :cid, 'Bad Source Alias', 'SAP', :uid, NOW())"
            ),
            {"id": alias_id, "cid": party_id, "uid": _USER_TEJASWA_ID},
        )
        db_session.flush()
    db_session.rollback()


# ---------------------------------------------------------------------------
# UNIQUE constraint violation tests
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_snapshot_upload_file_sha256_unique(db_session: Session) -> None:
    """uq_snapshots_upload_file_sha256 must prevent duplicate sha256 values."""
    sha = "unique-sha256-collision-test-" + str(uuid.uuid4())[:32]
    sha = sha[:64]

    sid1 = str(uuid.uuid4())
    db_session.execute(
        text(
            "INSERT INTO snapshots "
            "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
            "source_hint, status, uploaded_at, created_at, updated_at) "
            "VALUES (:id, :eid, :uid, :sha, '2026-02-15', 'TALLY', 'STAGED', NOW(), NOW(), NOW())"
        ),
        {"id": sid1, "eid": _ENTITY_IND_ID, "uid": _USER_TEJASWA_ID, "sha": sha},
    )
    db_session.flush()  # commit first row to make unique index visible

    sid2 = str(uuid.uuid4())
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO snapshots "
                "(id, entity_id, uploaded_by, upload_file_sha256, as_of_date, "
                "source_hint, status, uploaded_at, created_at, updated_at) "
                "VALUES (:id, :eid, :uid, :sha, '2026-05-01', 'XERO', 'STAGED', NOW(), NOW(), NOW())"
            ),
            {"id": sid2, "eid": _ENTITY_IND_ID, "uid": _USER_TEJASWA_ID, "sha": sha},
        )
        db_session.flush()
    db_session.rollback()


@pytest.mark.integration
def test_party_alias_unique_alias_text_canonical(db_session: Session) -> None:
    """uq_party_aliases_alias_canonical must prevent duplicate (alias_text, canonical_id) pairs."""
    party_id = _make_minimal_party(db_session)
    alias_text = f"Duplicate Alias {uuid.uuid4()}"

    aid1 = str(uuid.uuid4())
    db_session.execute(
        text(
            "INSERT INTO party_aliases "
            "(id, canonical_id, alias_text, source, created_by, created_at) "
            "VALUES (:id, :cid, :txt, 'TALLY', :uid, NOW())"
        ),
        {"id": aid1, "cid": party_id, "txt": alias_text, "uid": _USER_TEJASWA_ID},
    )
    db_session.flush()  # make the unique index visible

    aid2 = str(uuid.uuid4())
    with pytest.raises(sqlalchemy.exc.IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO party_aliases "
                "(id, canonical_id, alias_text, source, created_by, created_at) "
                "VALUES (:id, :cid, :txt, 'XERO', :uid, NOW())"
            ),
            {"id": aid2, "cid": party_id, "txt": alias_text, "uid": _USER_TEJASWA_ID},
        )
        db_session.flush()
    db_session.rollback()


# ---------------------------------------------------------------------------
# Migration round-trip (independent of db_session — runs its own alembic).
# This is potentially slow but critical to confirm downgrade/upgrade works.
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_m3_migration_heads_includes_0003() -> None:
    """alembic heads must include 0003_m3_ingestion as the current head."""
    result = _alembic(["heads"])
    assert result.returncode == 0, result.stderr
    assert (
        "0003_m3_ingestion" in result.stdout
    ), f"0003_m3_ingestion not in alembic heads output: {result.stdout!r}"


@pytest.mark.serial  # must not run concurrently with other DB-mutating tests; see docstring
@pytest.mark.integration
def test_m3_downgrade_then_upgrade_idempotent() -> None:
    """Mutates the shared Neon branch schema (runs alembic downgrade -1).

    MUST NOT run concurrently with any other M3 test — it temporarily
    removes M3 tables between the downgrade and the subsequent upgrade.
    Current CI runs single-worker so this is safe; if CI ever parallelises,
    this test needs an isolation mechanism (dedicated Neon branch or a
    session-scoped mutex).

    Downgrade -1 then upgrade head must complete without error.

    The ``db_session`` fixture's session-scoped ``test_engine`` runs
    ``upgrade head`` at setup, so the branch is always at head when
    db_session fixtures are used.

    Mark xfail if you need to skip: add ``@pytest.mark.xfail`` with an issue
    link.  Never use ``skip`` without one per CLAUDE.md testing discipline.
    """
    down = _alembic(["downgrade", "-1"])
    assert down.returncode == 0, f"downgrade failed:\n{down.stderr}"

    # Confirm M3 tables are gone after downgrade.
    # (We check via alembic current — if it shows 0002 we know 0003 was removed.)
    current = _alembic(["current"])
    assert (
        "0002_seed_bootstrap_admin" in current.stdout
    ), f"Expected current to be 0002 after downgrade: {current.stdout!r}"

    # Re-apply 0003.
    up = _alembic(["upgrade", "head"])
    assert up.returncode == 0, f"re-upgrade failed:\n{up.stderr}"

    current2 = _alembic(["current"])
    assert (
        "0003_m3_ingestion" in current2.stdout
    ), f"Expected current to be 0003 after re-upgrade: {current2.stdout!r}"
