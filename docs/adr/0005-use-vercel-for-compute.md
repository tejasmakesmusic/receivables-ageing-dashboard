# ADR 0005 - Use Vercel For Compute

- **Status:** Accepted
- **Date:** 2026-05-01
- **Related:** ADR-0002

## Decision

Use Vercel as the app compute and hosting platform. The repository root is a
Next.js app, and App Router route handlers own `/api/*`.

## Consequences

- Preview deployments are created by Vercel.
- Runtime environment variables are managed in Vercel.
- Neon remains the database provider.
- Uploaded workbook retention needs object storage before production because
  Vercel function filesystems are ephemeral.
- Scheduled jobs must use Vercel Cron or an external scheduler with a
  Postgres-backed lock.
