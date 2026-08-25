# Receivables Ageing Dashboard

Internal AR ageing dashboard for India and UAE receivables.

## Current Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Neon PostgreSQL via Prisma 7 and `@prisma/adapter-neon`
- Tailwind CSS 4 with local shadcn-style primitives
- ExcelJS for report generation
- SheetJS for workbook parsing
- Fuse.js for fuzzy party matching
- Recharts for dashboard charts
- Vercel for app compute

## Repo Layout

```text
src/ Next App Router pages, route handlers, UI, server services
prisma/ Introspected Prisma schema for the existing Neon database
docs/ ADRs, runbook, locked spec mirror
02_HANDOFF_SPEC.md Locked functional spec. Do not edit without approval.
```

## Local Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000/auth/google/login`. In local development,
`AUTH_PROVIDER=development` enables the stub admin flow.

### Fully Local Database

Neon remains the hosted default. For offline local development, run Postgres on
port `5433`, set `DATABASE_ADAPTER=pg` in ignored `.env.local`, then push and
seed the Prisma schema:

```bash
docker run -d --name receivables-postgres -e POSTGRES_USER=receivables -e POSTGRES_PASSWORD=receivables -e POSTGRES_DB=receivables -p 5433:5432 -v receivables-postgres-data:/var/lib/postgresql/data postgres:16-alpine
npx prisma db push --accept-data-loss
docker exec -i receivables-postgres psql -U receivables -d receivables < prisma/local-seed.sql
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The build command runs Prisma Client generation before `next build`.

## Deployment

Target: Vercel, region `sin1`, backed by Neon Postgres.

Set Vercel environment variables from `.env.example`. Use the pooled Neon
`DATABASE_URL` at runtime and keep `DATABASE_URL_DIRECT` available only for
explicit database maintenance/migration work.

## Xero API Ingestion

The UAE entity can create staged snapshots from a read-only Xero OAuth
connection (ADR-0012). Xero supplies source invoices and contacts;
Receivables OS still computes ageing from snapshot `as_of_date` and
configured credit days — Xero's own ageing buckets and due dates are not used.

Required environment variables when enabled (all five are optional, but
must be set together):

- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REDIRECT_URI`
- `XERO_OAUTH_SCOPES` (defaults to the granular post-March-2026 set: `openid profile email offline_access accounting.invoices.read accounting.contacts.read accounting.reports.aged.read`). Apps created before 2026-03-02 may still need the legacy broad scopes `accounting.transactions.read accounting.reports.read` — Xero retires those in September 2027.
- `XERO_TOKEN_ENCRYPTION_KEY` (minimum 32 characters; rotating it invalidates every stored refresh token)

Admin connection management lives at `/admin/xero`. Analysts with UAE
scope can trigger pulls via the "Pull from Xero" action on the upload
form. Each pull writes a `xero_sync_runs` row alongside the snapshot for
auditability. Tests use fixture JSON and do not require live Xero
credentials.

## Production Launch Readiness

Local code-verifiable gates before promoting a preview:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run prisma:migrate:status`
- Upload smoke test stores a workbook URI in `snapshots.upload_file_path` and a
SHA-256 in `snapshots.upload_file_sha256`
- Cron endpoints reject requests without `CRON_SECRET`
- Email rules remain inactive until Tejaswa explicitly activates them

External launch gates that require IT, finance, or admin signoff:

- Google Workspace OAuth credentials and callback URL configured in Vercel
- `CRON_SECRET`, `CRON_ACTOR_USER_ID`, `RESEND_API_KEY`,
`SMTP_FROM_ADDRESS`, and object-storage variables set in Vercel
- Resend domain, SPF, and DKIM verified for the sending domain
- S3/R2 workbook bucket created and access policy verified
- Neon backup/restore process documented and tested
- Sentry or equivalent error monitoring configured
- Vercel Analytics or equivalent usage/performance monitoring enabled
- Two-cycle real-data UAT and Excel parallel run signed off
- Analyst/admin/CFO user guide and support runbook accepted
- Rollback procedure reviewed with the launch owner

## Non-Negotiable Product Rules

- Every mutation writes an `audit_log` row with before/after JSON.
- RBAC is enforced in every route handler, not only in UI.
- Parser errors are staged as `PARSE_ERROR`; never silently drop rows.
- Ageing uses the snapshot `as_of_date`, never wall-clock today.
- FX lookup is pinned by `invoice_date`.
- CFO and PENDING users do not mutate or publish.
- Do not commit `.env`, OAuth secrets, SMTP keys, database dumps, or client data.
