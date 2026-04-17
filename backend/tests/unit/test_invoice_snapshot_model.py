"""InvoiceSnapshot model — columns, bucket CHECK, partitioned PK.

The partition-lookup test (insert a row with as_of_date=2026-02-15 and
confirm it lands in invoice_snapshots_2026_q1 via tableoid::regclass) is
in the integration suite (test_m3_migration.py) because it requires a live
DB connection.  Here we test the ORM model structure only.
"""

from __future__ import annotations

from app.db.models.invoice_snapshot import InvoiceSnapshot


def test_invoice_snapshot_has_required_columns() -> None:
    cols = {c.name for c in InvoiceSnapshot.__table__.columns}
    expected = {
        "id",
        "snapshot_id",
        "invoice_id",
        "as_of_date",
        "outstanding_amount",
        "overdue_days",
        "bucket",
        "created_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_invoice_snapshot_pk_includes_as_of_date() -> None:
    # Partitioned tables require the partition key in the PK.
    pk_cols = {c.name for c in InvoiceSnapshot.__table__.primary_key.columns}
    assert "id" in pk_cols
    assert (
        "as_of_date" in pk_cols
    ), "as_of_date must be part of the PK for Postgres partitioned tables"


def test_invoice_snapshot_bucket_check_constraint_exists() -> None:
    # Convention: short "bucket" → ck_invoice_snapshots_bucket
    ck_names = {
        cst.name
        for cst in InvoiceSnapshot.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_invoice_snapshots_bucket" in ck_names
    ), f"ck_invoice_snapshots_bucket missing; found: {ck_names}"


def test_invoice_snapshot_snapshot_id_index_exists() -> None:
    idx_names = {idx.name for idx in InvoiceSnapshot.__table__.indexes}
    assert "ix_invoice_snapshots_snapshot_id" in idx_names


def test_invoice_snapshot_as_of_date_bucket_index_exists() -> None:
    idx_names = {idx.name for idx in InvoiceSnapshot.__table__.indexes}
    assert "ix_invoice_snapshots_as_of_date_bucket" in idx_names


def test_invoice_snapshot_id_is_bigint() -> None:
    col = InvoiceSnapshot.__table__.c.id
    assert col.type.__class__.__name__ == "BigInteger"


def test_invoice_snapshot_overdue_days_allows_negative() -> None:
    # Spec §6 / §3: overdue_days can be negative for NOT_DUE invoices.
    col = InvoiceSnapshot.__table__.c.overdue_days
    assert not col.nullable
    # There is intentionally no CHECK (overdue_days >= 0).


def test_invoice_snapshot_snapshot_id_fk() -> None:
    col = InvoiceSnapshot.__table__.c.snapshot_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "snapshots"


def test_invoice_snapshot_invoice_id_fk() -> None:
    col = InvoiceSnapshot.__table__.c.invoice_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "invoices"
