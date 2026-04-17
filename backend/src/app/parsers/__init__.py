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
    is_empty_cell,
    stringify_cell,
)
from app.parsers.tally import parse_tally_grpbills
from app.parsers.xero import parse_xero_aged_receivables

__all__ = [
    "ParseError",
    "ParseResult",
    "ParseStatus",
    "StagedCreditPeriod",
    "StagedInvoice",
    "compute_file_sha256",
    "is_empty_cell",
    "parse_tally_grpbills",
    "parse_xero_aged_receivables",
    "stringify_cell",
]
