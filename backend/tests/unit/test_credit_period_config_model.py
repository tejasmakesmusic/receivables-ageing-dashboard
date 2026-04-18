"""CreditPeriodConfig model — columns, constraints, partial-unique index."""

from __future__ import annotations

from app.db.models.credit_period_config import CreditPeriodConfig


def test_credit_period_config_has_required_columns() -> None:
    cols = {c.name for c in CreditPeriodConfig.__table__.columns}
    expected = {
        "id",
        "canonical_id",
        "days",
        "reason_note",
        "valid_from",
        "valid_to",
        "updated_by",
        "updated_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_credit_period_config_days_check_constraint_exists() -> None:
    # credit_days >= 0 (0 is valid for immediate payment).
    # Naming convention: short name "days_non_negative"
    #   → ck_credit_period_config_days_non_negative
    ck_names = {
        cst.name
        for cst in CreditPeriodConfig.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_credit_period_config_days_non_negative" in ck_names
    ), f"CHECK (days >= 0) constraint missing; found: {ck_names}"


def test_credit_period_config_partial_unique_open_index_exists() -> None:
    # At most one open row per canonical_id (valid_to IS NULL).
    # Declared in __table_args__ with postgresql_where.
    idx_names = {idx.name for idx in CreditPeriodConfig.__table__.indexes}
    assert (
        "ix_credit_period_config_open" in idx_names
    ), f"Partial unique index ix_credit_period_config_open missing; found: {idx_names}"


def test_credit_period_config_latest_lookup_index_exists() -> None:
    # (canonical_id, valid_from) compound index for latest-lookup queries.
    idx_names = {idx.name for idx in CreditPeriodConfig.__table__.indexes}
    assert "ix_credit_period_config_canonical_valid_from" in idx_names


def test_credit_period_config_valid_to_nullable() -> None:
    # valid_to IS NULL means the row is currently active.
    assert CreditPeriodConfig.__table__.c.valid_to.nullable is True


def test_credit_period_config_canonical_fk() -> None:
    col = CreditPeriodConfig.__table__.c.canonical_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "parties_canonical"


def test_credit_period_config_updated_by_fk() -> None:
    col = CreditPeriodConfig.__table__.c.updated_by
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "users"


def test_credit_period_config_reason_note_nullable() -> None:
    assert CreditPeriodConfig.__table__.c.reason_note.nullable is True
