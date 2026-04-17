"""Invoice model — columns, uniqueness, CHECK constraints (spec §3)."""

from __future__ import annotations

from app.db.models.invoice import Invoice


def test_invoice_has_required_columns() -> None:
    cols = {c.name for c in Invoice.__table__.columns}
    expected = {
        "id",
        "entity_id",
        "canonical_id",
        "invoice_ref",
        "invoice_date",
        "amount",
        "currency",
        "credit_days_applied",
        "credit_days_source",
        "due_date",
        "status",
        "first_seen_snapshot_id",
        "settled_snapshot_id",
        "raw_row_json",
        "xero_metadata",
        "created_at",
        "updated_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_invoice_unique_entity_canonical_ref() -> None:
    # Spec §3 UNIQUE(entity_id, canonical_id, invoice_ref) — match key for upsert.
    uq_sets = [
        {c.name for c in cst.columns}
        for cst in Invoice.__table__.constraints
        if cst.__class__.__name__ == "UniqueConstraint"
    ]
    assert {
        "entity_id",
        "canonical_id",
        "invoice_ref",
    } in uq_sets, "UNIQUE(entity_id, canonical_id, invoice_ref) missing from invoices"


def test_invoice_status_check_constraint_exists() -> None:
    # Convention: short "status" → ck_invoices_status
    ck_names = {
        cst.name
        for cst in Invoice.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert "ck_invoices_status" in ck_names, f"ck_invoices_status missing; found: {ck_names}"


def test_invoice_credit_days_source_check_constraint_exists() -> None:
    ck_names = {
        cst.name
        for cst in Invoice.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_invoices_credit_days_source" in ck_names
    ), f"ck_invoices_credit_days_source missing; found: {ck_names}"


def test_invoice_currency_check_constraint_exists() -> None:
    ck_names = {
        cst.name
        for cst in Invoice.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert "ck_invoices_currency" in ck_names, f"ck_invoices_currency missing; found: {ck_names}"


def test_invoice_entity_index_exists() -> None:
    idx_names = {idx.name for idx in Invoice.__table__.indexes}
    assert "ix_invoices_entity_id" in idx_names


def test_invoice_open_partial_index_exists() -> None:
    # Spec §3 partial index for OPEN invoices — declared in __table_args__.
    idx_names = {idx.name for idx in Invoice.__table__.indexes}
    assert (
        "ix_invoices_status_open" in idx_names
    ), f"ix_invoices_status_open missing; found: {idx_names}"


def test_invoice_settled_snapshot_id_nullable() -> None:
    # NULL = invoice is still OPEN; set when invoice transitions to SETTLED.
    assert Invoice.__table__.c.settled_snapshot_id.nullable is True


def test_invoice_xero_metadata_nullable() -> None:
    # Only populated for UAE/Xero invoices.
    assert Invoice.__table__.c.xero_metadata.nullable is True


def test_invoice_first_seen_snapshot_fk() -> None:
    col = Invoice.__table__.c.first_seen_snapshot_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "snapshots"


def test_invoice_entity_fk() -> None:
    col = Invoice.__table__.c.entity_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "entities"


def test_invoice_repr_does_not_include_invoice_ref() -> None:
    # CLAUDE.md: invoice_ref is client-identifiable — verify repr source.
    # We check that self.invoice_ref and self.raw_row_json are not accessed.
    import inspect

    src = inspect.getsource(Invoice.__repr__)
    assert "self.invoice_ref" not in src, "self.invoice_ref must not appear in Invoice.__repr__"
    assert "self.raw_row_json" not in src, "self.raw_row_json must not appear in Invoice.__repr__"
