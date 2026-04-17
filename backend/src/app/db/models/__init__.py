"""Model re-exports so `from app.db.models import Entity` works.

Each concrete model is added here as it lands.  Importing this package
triggers all model modules to load, which populates ``Base.metadata`` for
Alembic autogenerate.

M1 models: Entity, User, FxRate, AuditLog
M3 models: Snapshot, PartyCanonical, PartyAlias, CreditPeriodConfig,
           Invoice, InvoiceSnapshot, ExceptionBucketType
"""

from __future__ import annotations

from app.db.models.audit_log import AuditLog
from app.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.models.credit_period_config import CreditPeriodConfig
from app.db.models.entity import Entity
from app.db.models.exception_bucket_type import ExceptionBucketType
from app.db.models.fx_rate import FxRate, FxRateSource
from app.db.models.invoice import Invoice
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.party import PartyAlias, PartyCanonical
from app.db.models.snapshot import Snapshot
from app.db.models.user import User

__all__ = [
    "AuditLog",
    "Base",
    "CreditPeriodConfig",
    "Entity",
    "ExceptionBucketType",
    "FxRate",
    "FxRateSource",
    "Invoice",
    "InvoiceSnapshot",
    "PartyAlias",
    "PartyCanonical",
    "Snapshot",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
]
