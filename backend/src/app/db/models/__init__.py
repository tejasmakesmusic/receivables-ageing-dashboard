"""Model re-exports so `from app.db.models import Entity` works.

Each concrete model is added here as it lands.  Importing this package
triggers all model modules to load, which populates ``Base.metadata`` for
Alembic autogenerate.

M1 models: Entity, User, FxRate, AuditLog
M3 models: Snapshot, PartyCanonical, PartyAlias, CreditPeriodConfig,
           Invoice, InvoiceSnapshot, ExceptionBucketType
M3 Task 5: ExceptionTag, EmailOutbox
M4-M6:     ReconciliationEntry, FollowUp
"""

from __future__ import annotations

from app.db.models.audit_log import AuditLog
from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.credit_period_config import CreditPeriodConfig
from app.db.models.email_outbox import EmailOutbox
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.exception_tag import ExceptionTag
from app.db.models.follow_up import FollowUp
from app.db.models.fx_rate import FxRate, FxRateSource
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.reconciliation_entry import ReconciliationEntry
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

__all__ = [
    "AuditLog",
    "Base",
    "CreditPeriodConfig",
    "EmailOutbox",
    "Entity",
    "ExceptionBucketType",
    "ExceptionTag",
    "FollowUp",
    "FxRate",
    "FxRateSource",
    "Invoice",
    "InvoiceSnapshot",
    "PartyAlias",
    "PartyCanonical",
    "ReconciliationEntry",
    "Snapshot",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
]
