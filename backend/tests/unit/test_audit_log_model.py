"""AuditLog model — columns + jsonb before/after + indexed created_at."""

from __future__ import annotations

from app.db.models.audit_log import AuditLog


def test_audit_log_columns() -> None:
    cols = {c.name for c in AuditLog.__table__.columns}
    expected = {
        "id",
        "actor_user_id",
        "action",
        "entity_type",
        "entity_id",
        "before",
        "after",
        "created_at",
    }
    assert expected.issubset(cols), f"missing: {expected - cols}"


def test_audit_log_actor_nullable() -> None:
    # System/bootstrap actions have NULL actor.
    assert AuditLog.__table__.c.actor_user_id.nullable is True


def test_audit_log_before_after_jsonb() -> None:
    before = AuditLog.__table__.c.before
    after = AuditLog.__table__.c.after
    # JSONB via postgresql dialect
    assert before.type.__class__.__name__ in {"JSONB", "JSON"}
    assert after.type.__class__.__name__ in {"JSONB", "JSON"}


def test_audit_log_created_at_indexed() -> None:
    idx_cols = {tuple(i.columns.keys()) for i in AuditLog.__table__.indexes}
    assert ("created_at",) in idx_cols
