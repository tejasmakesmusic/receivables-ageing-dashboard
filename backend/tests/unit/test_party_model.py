"""PartyCanonical + PartyAlias model — columns, uniqueness, and alias source enum."""

from __future__ import annotations

from app.db.models.party import PartyAlias, PartyCanonical

# ---------------------------------------------------------------------------
# PartyCanonical
# ---------------------------------------------------------------------------


def test_party_canonical_has_required_columns() -> None:
    cols = {c.name for c in PartyCanonical.__table__.columns}
    expected = {"id", "entity_id", "name", "notes", "created_by", "created_at"}
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_party_canonical_unique_entity_name() -> None:
    # Spec §3 UNIQUE(entity_id, name) — prevents duplicate canonical parties
    # within the same entity.
    uq_sets = [
        {c.name for c in cst.columns}
        for cst in PartyCanonical.__table__.constraints
        if cst.__class__.__name__ == "UniqueConstraint"
    ]
    assert {
        "entity_id",
        "name",
    } in uq_sets, "UNIQUE(entity_id, name) constraint missing from parties_canonical"


def test_party_canonical_entity_id_index() -> None:
    idx_names = {idx.name for idx in PartyCanonical.__table__.indexes}
    assert "ix_parties_canonical_entity_id" in idx_names


def test_party_canonical_entity_fk() -> None:
    col = PartyCanonical.__table__.c.entity_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "entities"


def test_party_canonical_created_by_fk() -> None:
    col = PartyCanonical.__table__.c.created_by
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "users"


def test_party_canonical_notes_nullable() -> None:
    assert PartyCanonical.__table__.c.notes.nullable is True


def test_party_canonical_repr_does_not_include_name() -> None:
    # CLAUDE.md: party names must not leak into non-debug reprs.
    import inspect

    src = inspect.getsource(PartyCanonical.__repr__)
    assert "self.name" not in src, "party name must not appear in PartyCanonical.__repr__"


# ---------------------------------------------------------------------------
# PartyAlias
# ---------------------------------------------------------------------------


def test_party_alias_has_required_columns() -> None:
    cols = {c.name for c in PartyAlias.__table__.columns}
    expected = {
        "id",
        "canonical_id",
        "alias_text",
        "source",
        "confidence",
        "confirmed_by",
        "confirmed_at",
        "created_by",
        "created_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_party_alias_unique_canonical_alias() -> None:
    # Spec §3 UNIQUE(alias_text, canonical_id).
    uq_sets = [
        {c.name for c in cst.columns}
        for cst in PartyAlias.__table__.constraints
        if cst.__class__.__name__ == "UniqueConstraint"
    ]
    assert {
        "canonical_id",
        "alias_text",
    } in uq_sets, "UNIQUE(canonical_id, alias_text) constraint missing from party_aliases"


def test_party_alias_source_check_constraint_exists() -> None:
    # Convention: short "source" → ck_party_aliases_source
    ck_names = {
        cst.name
        for cst in PartyAlias.__table__.constraints
        if cst.__class__.__name__ == "CheckConstraint"
    }
    assert (
        "ck_party_aliases_source" in ck_names
    ), f"ck_party_aliases_source missing; found: {ck_names}"


def test_party_alias_alias_text_index() -> None:
    idx_names = {idx.name for idx in PartyAlias.__table__.indexes}
    assert "ix_party_aliases_alias_text" in idx_names


def test_party_alias_confidence_nullable() -> None:
    # Manually created / exact-match aliases may not have a confidence score.
    assert PartyAlias.__table__.c.confidence.nullable is True


def test_party_alias_canonical_id_fk() -> None:
    col = PartyAlias.__table__.c.canonical_id
    fks = list(col.foreign_keys)
    assert len(fks) == 1
    assert fks[0].column.table.name == "parties_canonical"


def test_party_alias_repr_does_not_include_alias_text() -> None:
    import inspect

    src = inspect.getsource(PartyAlias.__repr__)
    assert "self.alias_text" not in src, "self.alias_text must not appear in PartyAlias.__repr__"
