# ADR 0002 - Use Neon For Postgres

- **Status:** Accepted
- **Date:** 2026-04-16

## Decision

Use Neon Postgres for development, preview, and production.

Runtime access uses Prisma 7 through `@prisma/adapter-neon`. The pooled Neon
connection string is used for app traffic. The direct connection string is kept
for explicit maintenance and migration work.

## Environment

- `DATABASE_URL`: pooled Neon runtime URL
- `DATABASE_URL_DIRECT`: direct Neon URL for explicit database operations

## Consequences

- No local Postgres container is required for normal development.
- Serverless connection pressure is handled by Neon pooling and Prisma's Neon
  adapter.
- Database dumps must never be committed to the repo.
