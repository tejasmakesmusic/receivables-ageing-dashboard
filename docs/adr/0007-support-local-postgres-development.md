# ADR 0007 - Support Local Postgres Development

- **Status:** Accepted
- **Date:** 2026-05-01
- **Related:** ADR-0002, ADR-0006

## Decision

Keep Neon Postgres as the hosted default for development, preview, and
production, while allowing a fully local Postgres database for offline developer
work.

Runtime database access uses:

- `@prisma/adapter-neon` for Neon URLs.
- `@prisma/adapter-pg` for localhost Postgres URLs or when
  `DATABASE_ADAPTER=pg` is set.

## Consequences

- Vercel and shared environments continue to use Neon pooled connection
  strings.
- Local development can run against Docker Postgres on port `5433` without
  changing committed secrets.
- Local reference data is kept in `prisma/local-seed.sql`.
