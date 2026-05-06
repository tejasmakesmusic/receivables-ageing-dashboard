# ADR 0008 - Full Prisma Migration Cutover (Freeze Alembic)

- **Status:** Accepted
- **Date:** 2026-05-02
- **Related:** ADR-0006 (Next/Prisma strangler migration), ADR-0007 (local Postgres)

## Context

The project was originally bootstrapped with a FastAPI + Alembic backend. ADR-0006
recorded the decision to migrate to Next.js + Prisma as the sole application layer.
The Alembic chain (`alembic_version` table) was introspected by Prisma but never
actively driven from the Next/Prisma codebase.

Phase 2 of the Receivables OS plan adds four new operational tables
(`collection_tasks`, `promises_to_pay`, `dispute_cases`, `digest_events`) that have
no equivalent in the Alembic history. Continuing to maintain two parallel migration
chains is unsustainable and error-prone.

## Decision

1. **Freeze Alembic.** No new Alembic migrations will be authored after Phase 2.
   The existing `alembic_version` table and migration files are preserved in the
   repository as a historical record but are no longer the source of schema truth.

2. **Prisma is the sole migration authority from Phase 2 onward.** All schema
   changes use `prisma migrate dev` (local) and `prisma migrate deploy`
   (staging / production via `DATABASE_URL_DIRECT`).

3. **Baseline migration.** The first Prisma migration captures only the *new*
   tables added in Phase 2. The existing tables (which were created by Alembic) are
   already present in the database and are not re-created by Prisma migrations.
   `prisma migrate resolve --applied <migration_name>` is used if the migration
   history diverges.

4. **Local development.** Developers run `prisma migrate dev` against local Postgres
   (Docker, port 5433) per ADR-0007. Neon staging/production uses
   `prisma migrate deploy` with `DATABASE_URL_DIRECT`.

5. **CI gate.** The CI workflow runs `prisma migrate status` to confirm no pending
   migrations exist before a PR merges to main.

## Consequences

- Schema drift between Alembic and Prisma for the legacy tables is accepted; Prisma
  introspection captures the existing table shapes accurately.
- Any developer who ran `prisma migrate dev` before this ADR was accepted may have
  an inconsistent local migration history. Reset with `prisma migrate reset` on the
  local database only.
- The `alembic_version` model in `schema.prisma` is retained as a read-only marker;
  no Prisma migration will touch it.
- Future schema changes must go through Prisma. Opening a PR with an Alembic
  migration file is a build-failure condition.
