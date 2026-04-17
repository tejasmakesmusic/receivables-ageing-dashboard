"""Excel parsers for Tally / Xero / Credit Period master (spec §4).

Planned modules (Milestone 2):
  tally.py           — parses GrpBills.xlsx, sheet 'Sundry Debtors'
  xero.py            — parses Aged Receivables Detail.xlsx
  credit_period.py   — parses India/UAE sheets; drops UAE `Amount` col (D20)
  common.py          — StagedInvoice / StagedCreditPeriod dataclasses, PARSE_ERROR staging
"""

from app.parsers.common import (
    ParseError,
    ParseResult,
    ParseStatus,
    StagedCreditPeriod,
    StagedInvoice,
    compute_file_sha256,
)

__all__ = [
    "ParseError",
    "ParseResult",
    "ParseStatus",
    "StagedCreditPeriod",
    "StagedInvoice",
    "compute_file_sha256",
]
