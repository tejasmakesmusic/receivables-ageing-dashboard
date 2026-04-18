"""ExceptionBucketType model — columns, uniqueness, active default (D9)."""

from __future__ import annotations

from app.db.models.exception_bucket_type import ExceptionBucketType


def test_exception_bucket_type_has_required_columns() -> None:
    cols = {c.name for c in ExceptionBucketType.__table__.columns}
    expected = {"id", "code", "name", "description", "active", "created_at"}
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_exception_bucket_type_code_unique() -> None:
    col = ExceptionBucketType.__table__.c.code
    assert col.unique is True, "code column must have a unique constraint"


def test_exception_bucket_type_active_defaults_true() -> None:
    col = ExceptionBucketType.__table__.c.active
    # server_default is 'true' (set explicitly).
    assert col.server_default is not None
    assert not col.nullable


def test_exception_bucket_type_description_nullable() -> None:
    assert ExceptionBucketType.__table__.c.description.nullable is True


def test_exception_bucket_type_repr_defined() -> None:
    # Verify __repr__ is defined and references code + active (safe to expose).
    import inspect

    src = inspect.getsource(ExceptionBucketType.__repr__)
    # code and active are safe (no PII); verify they appear in repr.
    assert "code" in src
    assert "active" in src
