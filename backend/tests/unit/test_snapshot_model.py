"""Snapshot model — columns, constraints, and invariants (spec §3 + D17)."""

from __future__ import annotations

from app.db.models.snapshot import Snapshot


def test_snapshot_has_required_columns() -> None:
    cols = {c.name for c in Snapshot.__table__.columns}
    expected = {
        "id",
        "entity_id",
        "uploaded_by",
        "upload_file_path",
        "upload_file_sha256",
        "as_of_date",
        "source_hint",
        "status",
        "row_count",
        "total_outstanding",
        "parse_result_json",
        "warnings_acknowledged_json",
        "uploaded_at",
        "published_as",
        "published_at",
        "published_by",
        "discarded_at",
        "discarded_by",
        "created_at",
        "updated_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_snapshot_upload_file_sha256_unique() -> None:
    # spec §4.4 — duplicate-file rejection at the DB level.
    uq_sets = [
        {c.name for c in cst.columns}
        for cst in Snapshot.__table__.constraints
        if cst.__class__.__name__ == "UniqueConstraint"
    ]
    assert {
        "upload_file_sha256"
    } in uq_sets, "upload_file_sha256 must have a UNIQUE constraint (spec §4.4)"


def test_snapshot_status_check_constraint_exists() -> None:
    # Naming convention: "ck_%(table_name)s_%(constraint_name)s"
    # short name "status" → ck_snapshots_status
    ck_names = {
        cst.name
        for cst in Snapshot.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_snapshots_status" in ck_names
    ), f"ck_snapshots_status CHECK constraint missing; found: {ck_names}"


def test_snapshot_source_hint_check_constraint_exists() -> None:
    ck_names = {
        cst.name
        for cst in Snapshot.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_snapshots_source_hint" in ck_names
    ), f"ck_snapshots_source_hint CHECK constraint missing; found: {ck_names}"


def test_snapshot_published_as_check_constraint_exists() -> None:
    # D17 — published_as must be NULL or in {'NORMAL', 'OVERRIDE'}.
    ck_names = {
        cst.name
        for cst in Snapshot.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_snapshots_published_as" in ck_names
    ), f"ck_snapshots_published_as CHECK constraint missing (D17); found: {ck_names}"


def test_snapshot_status_defaults_to_staged() -> None:
    col = Snapshot.__table__.c.status
    assert col.server_default is not None


def test_snapshot_warnings_acknowledged_json_default() -> None:
    # Publish gate reads this column — must have a server_default of '[]'.
    col = Snapshot.__table__.c.warnings_acknowledged_json
    assert col.server_default is not None
    assert not col.nullable


def test_snapshot_published_at_nullable() -> None:
    # NULL = not yet published.
    assert Snapshot.__table__.c.published_at.nullable is True


def test_snapshot_published_by_nullable() -> None:
    assert Snapshot.__table__.c.published_by.nullable is True


def test_snapshot_discarded_fields_nullable() -> None:
    assert Snapshot.__table__.c.discarded_at.nullable is True
    assert Snapshot.__table__.c.discarded_by.nullable is True


def test_snapshot_entity_fk() -> None:
    col = Snapshot.__table__.c.entity_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "entities"


def test_snapshot_uploaded_by_fk_to_users() -> None:
    col = Snapshot.__table__.c.uploaded_by
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "users"


def test_snapshot_entity_status_index_exists() -> None:
    idx_names = {idx.name for idx in Snapshot.__table__.indexes}
    assert "ix_snapshots_entity_status" in idx_names


def test_snapshot_repr_defined() -> None:
    # Verify __repr__ is defined on the class (not inherited from object).
    assert "__repr__" in Snapshot.__dict__, "Snapshot must define __repr__"
    # Repr source must not reference raw client-data fields.
    import inspect

    src = inspect.getsource(Snapshot.__repr__)
    assert "invoice_ref" not in src
    assert "raw_row_json" not in src
