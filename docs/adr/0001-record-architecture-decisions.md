# ADR 0001 - Record Architecture Decisions

- **Status:** Accepted
- **Date:** 2026-04-16

## Decision

Architecture decisions are captured in `docs/adr/` as short markdown records.
The locked functional spec remains `02_HANDOFF_SPEC.md`; ADRs document approved
technical deviations and implementation choices.

## Current Baseline

The current runtime baseline is:

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma 7 with `@prisma/adapter-neon`
- Neon Postgres
- Tailwind CSS 4
- Vercel

## Consequences

- New technical deviations need an ADR.
- Functional behavior still follows the locked spec unless an ADR explicitly
  supersedes a technical implementation detail.
