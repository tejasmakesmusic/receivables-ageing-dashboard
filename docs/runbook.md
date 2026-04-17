# Runbook

Operational procedures for the Receivables Ageing Dashboard on Railway.

Populated as M1 deploys skeleton → M8 cuts over. Until then, intentionally
sparse. Sections to fill in:

- Deploy / rollback (Railway)
- DB migrations (`uv run alembic upgrade head`, rollback steps)
- Restoring from Railway backup + weekly `pg_dump`
- Resend / SendGrid failure mode (digest didn't fire, publish-notif stuck)
- APScheduler double-fire debug
- First-time admin seed (CLI)
- SPF / DKIM / DMARC verification for `emb.global`
- Google OAuth redirect URI rotation
- FX rate incident (rate set wrong → consolidated view mis-stated)
- Reconciliation mismatch (spec §13 consequence #6)

See also `02_HANDOFF_SPEC.md` §11 (non-functional requirements) and
§13 (consequences 9–16 — deployment-specific).

---

## Partitioning invoice_snapshots

`invoice_snapshots` is partitioned `BY RANGE (as_of_date)` using quarterly
partitions created per the naming convention:

    invoice_snapshots_<YYYY>_q<N>

where `N = 1` (Jan-Mar), `2` (Apr-Jun), `3` (Jul-Sep), `4` (Oct-Dec).

Two partitions (2026-Q1, 2026-Q2) are seeded by migration `0003_m3_ingestion`.
Before the first upload whose `as_of_date` falls into a **new** quarter, you
must create the partition manually (or via a maintenance cron in M6).

### DDL template

```sql
-- Replace YYYY, QN, start_date (inclusive), end_date (exclusive).
CREATE TABLE invoice_snapshots_YYYY_qN
    PARTITION OF invoice_snapshots
    FOR VALUES FROM ('YYYY-MM-DD') TO ('YYYY-MM-DD');
```

### Examples

```sql
-- Q3 2026: 2026-07-01 to 2026-09-30 (upper exclusive → 2026-10-01)
CREATE TABLE invoice_snapshots_2026_q3
    PARTITION OF invoice_snapshots
    FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');

-- Q4 2026: 2026-10-01 to 2026-12-31 (upper exclusive → 2027-01-01)
CREATE TABLE invoice_snapshots_2026_q4
    PARTITION OF invoice_snapshots
    FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');

-- Q1 2027:
CREATE TABLE invoice_snapshots_2027_q1
    PARTITION OF invoice_snapshots
    FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
```

### What happens if you forget

Postgres raises `no partition of relation "invoice_snapshots" found for row`
on the first INSERT with an `as_of_date` outside all defined partition
ranges.  The upload endpoint will return HTTP 500.  Create the partition and
retry the upload.

### Quarter boundary dates

| Quarter | FROM (inclusive) | TO (exclusive) |
|---------|-----------------|----------------|
| Q1      | YYYY-01-01      | YYYY-04-01     |
| Q2      | YYYY-04-01      | YYYY-07-01     |
| Q3      | YYYY-07-01      | YYYY-10-01     |
| Q4      | YYYY-10-01      | YYYY+1-01-01   |

### Dropping old partitions

Partitions can be detached and archived independently once the data is
beyond the retention window:

```sql
-- Detach (keeps the table as a standalone, no FK constraints broken)
ALTER TABLE invoice_snapshots DETACH PARTITION invoice_snapshots_2026_q1;
-- Archive / backup the detached table, then drop:
DROP TABLE invoice_snapshots_2026_q1;
```
