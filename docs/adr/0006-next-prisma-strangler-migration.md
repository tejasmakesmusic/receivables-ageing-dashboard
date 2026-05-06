# ADR 0006 - Complete Cutover To Next.js And Prisma

- **Status:** Accepted
- **Date:** 2026-05-01
- **Related:** ADR-0002, ADR-0005

## Decision

The application runtime is now a single Next.js 16 App Router app at the repo
root.

The approved stack is:

- Next.js 16 App Router
- React 19
- TypeScript
- Prisma 7 with `@prisma/adapter-neon`
- Neon Postgres
- Tailwind CSS 4
- ExcelJS
- SheetJS
- Fuse.js
- Recharts
- Vercel

## Implementation Notes

- Prisma schema is introspected from the existing Neon database.
- Prisma Client is generated into `src/generated/prisma`.
- Database clients are initialized lazily for build-safe Next modules.
- Route handlers enforce RBAC and write audit rows for mutations.
- Parser, staging, publish, dashboard, admin/config, follow-ups, exceptions, and
  report-generation flows are implemented in TypeScript.

## Consequences

- The repo no longer carries separate runtime services.
- Future dependencies should fit the approved TypeScript/Next runtime unless a
  new ADR says otherwise.
