# ADR 0002 — Use Neon for Postgres (dev + prod), deviation from D21

- **Status:** Accepted
- **Date:** 2026-04-16
- **Deciders:** Tejaswa Sharma
- **Supersedes:** part of D21 in `02_HANDOFF_SPEC.md`

## Context

Handoff spec D21 pinned Postgres to the **Railway-managed add-on**. After
scaffold, Tejaswa chose **Neon** (serverless Postgres) instead. Railway
remains the host for the FastAPI service (D21 unchanged for compute).

## Decision

1. **Neon is the Postgres provider** for every environment (local dev,
   staging, production). No local Docker Postgres, no Railway Postgres.
2. Two DSNs are kept in env:
   - `DATABASE_URL` — pooled (pgbouncer) endpoint, used by the app at runtime.
   - `DATABASE_URL_DIRECT` — unpooled endpoint, used by Alembic (pgbouncer
     transaction pooling drops session-level statements some migrations need).
3. Connection strings always carry `sslmode=require` — Neon enforces TLS.
4. SQLAlchemy stays on `psycopg` (v3); no driver change.
5. Branching: later milestones may use Neon branches for preview envs /
   integration testing. Out of scope for M0.

## Consequences

**Positive**
- Scale-to-zero on dev branches → zero idle cost.
- Instant DB branching for preview / integration without data copy.
- One less moving part locally (no Docker Postgres container).
- Backups + PITR covered by Neon; the weekly `pg_dump → S3` in spec §11
  still runs for portability (belt-and-suspenders).

**Negative / watch-outs**
- **pgbouncer quirks:** the app must use the pooled URL, migrations must
  use the direct URL. Wiring: `alembic/env.py` prefers `DATABASE_URL_DIRECT`
  when set, falls back to `DATABASE_URL`.
- **Cold-start latency:** compute auto-suspends after inactivity. Fine for
  M0; if the 9 AM IST digest (§8.1) ever spikes a cold start, we can set a
  keep-warm cron or raise the suspension threshold.
- **Portability off Railway/Neon:** we remain portable because the DSN is
  standard Postgres. Migrating off Neon later is a DSN swap + data dump.
- **Spec contradiction:** D21 explicitly says "Railway-managed" Postgres.
  This ADR formally overrides that clause. All future work references
  Neon as the DB provider, and Railway only as the app host.

## Implementation notes (M0)

- `.env.example` — uses Neon example DSNs with `sslmode=require`.
- `backend/src/app/config.py` — adds `database_url_direct` setting.
- `backend/alembic/env.py` — uses `DATABASE_URL_DIRECT` in preference.
- `docker-compose.yml` — postgres service removed; backend + frontend
  services retained for optional container-based dev.
- Railway env vars (M1 day 3 deploy): set both `DATABASE_URL` and
  `DATABASE_URL_DIRECT` from the Neon dashboard.

## References

- `02_HANDOFF_SPEC.md` D21, §11
- ADR-0001
- Neon docs: https://neon.tech/docs/connect/connect-from-any-app
- Neon + Alembic / pgbouncer: https://neon.tech/docs/connect/connection-pooling
