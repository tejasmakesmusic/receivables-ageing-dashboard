-- ADR-0013: add derived base-currency amount on invoices.
--
-- Stores the invoice amount converted into the entity's base currency at
-- publish time, using the source-system FX rate (Xero's per-invoice
-- `CurrencyRate` for Xero pulls; NULL otherwise — Tally and manual
-- spreadsheet pulls do not carry a per-row rate today).
--
-- Nullable on purpose: per CLAUDE.md "Never auto-backfill historical
-- data", existing rows stay NULL and only newly published / republished
-- snapshots populate the column going forward.

ALTER TABLE "invoices"
    ADD COLUMN "amount_base" NUMERIC(18, 2);
