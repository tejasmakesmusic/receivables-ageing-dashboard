# Runbook

Operational procedures for the Receivables Ageing Dashboard on Vercel with Neon
Postgres.

## Preview Deploy

1. Confirm the working tree contains only intentional changes.
2. Set Vercel preview environment variables from `.env.example`.
3. Run local checks:

```bash
npm run typecheck
npm run lint
npm run build
```

4. Deploy:

```bash
vercel deploy
```

5. Smoke-test:
   - `/api/health`
   - login / pending flow
   - `/dashboard`
   - `/party/:canonical_id`
   - `/invoice/:invoice_id`
   - `/follow-ups`
   - `/api/reports/ageing`

## Production Promote

1. Complete the production launch checklist below.
2. Verify the preview deployment.
3. Apply any approved Prisma database migration using the direct Neon DSN.
4. Promote the verified deployment:

```bash
vercel promote <deployment-url>
```

5. Verify `https://<domain>/api/health` and one authenticated dashboard load.

## Production Launch Checklist

Code-verifiable before launch:

- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm test` passes.
- `npm run build` passes.
- `npm run prisma:migrate:status` reports no pending migrations.
- `/api/health` returns 200 in the target deployment.
- A preview upload stores `snapshots.upload_file_sha256` and an
  `s3://...` `snapshots.upload_file_path`.
- `/api/admin/digest/trigger` rejects missing or invalid `CRON_SECRET`.
- `/api/admin/email-outbox/process` rejects missing or invalid `CRON_SECRET`.
- Email rules for CFO digest/customer reminders remain inactive until the owner
  explicitly activates them.

External signoff required:

- Google Workspace OAuth is configured with the production callback URL and
  restricted to `emb.global`.
- Vercel production env vars are set from `.env.example`, including
  `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SESSION_SECRET`, Google OAuth values,
  `CRON_SECRET`, email values, and object-storage values.
- Resend sending domain is verified with SPF and DKIM records for `emb.global`.
- S3/R2-compatible workbook bucket exists, rejects public reads, and accepts
  uploads from the app credentials.
- Neon automated backup/PITR settings are confirmed.
- A restore test has been completed against a non-production database.
- Sentry or equivalent error monitoring is configured for server errors.
- Vercel Analytics or equivalent performance/usage monitoring is enabled.
- Real India Tally and UAE Xero workbooks are available for UAT.
- Finance signs off two parallel Excel-vs-system snapshot cycles.
- Analyst/admin/CFO user guide is published.
- Launch owner has reviewed rollback and incident contacts.

## Rollback

Use Vercel deployment history to promote the last known-good deployment. Roll
back database migrations only if the migration itself is faulty and the rollback
has been reviewed.

Before rollback:

1. Freeze new uploads and publish actions.
2. Record the current deployment URL, commit SHA, and incident reason.
3. Preserve relevant logs from Vercel, Neon, Resend, and monitoring.

After rollback:

1. Re-run `/api/health`.
2. Confirm authenticated dashboard load.
3. Smoke-test upload staging without publishing live finance data.
4. Confirm queued emails are not duplicated.
5. Notify finance users of status and workaround.

## Database Backups

Neon provides automated backups/PITR. Keep a portable weekly dump outside this
repo:

```bash
pg_dump "$DATABASE_URL_DIRECT" | gzip > receivables-$(date +%F).sql.gz
```

Store dumps in a controlled backup bucket. Do not commit dumps.

Restore test:

1. Restore the latest backup to a non-production Neon database.
2. Run `npm run prisma:migrate:status` against the restored database.
3. Verify sample counts for users, snapshots, invoices, invoice snapshots, and
   audit logs.
4. Load `/dashboard`, `/snapshots`, and `/admin/audit-log` against the restored
   database.
5. Record restore timestamp, duration, and any data gaps in the launch tracker.

## Scheduler Guardrail

Use Vercel Cron or an external scheduler hitting an authenticated endpoint. Guard
execution with a Postgres-backed lock so retries cannot send duplicate CFO
emails.

Configured cron jobs:

- Digest trigger: `30 3 * * 1-5` UTC, equal to 9:00 AM IST Monday-Friday.
- Email outbox processor: every 5 minutes.

Both cron routes must require `Authorization: Bearer <CRON_SECRET>`.

## Monitoring

Minimum production alerts:

- API error rate exceeds 1% for 10 minutes.
- Dashboard p95 latency exceeds 3 seconds for 15 minutes.
- Upload failure rate exceeds 10% in a day.
- Email failures exceed 5 sends or repeated bounce.
- Digest or email cron misses a scheduled run.
- Neon connection pool availability drops below 50%.
- Reconciliation status is `MISMATCHED` on the latest published snapshot.

## Uploaded Workbook Retention

Vercel function filesystems are ephemeral. Before production cutover, store
uploaded source workbooks in object storage and keep only hashes/metadata in the
database unless retention policy says otherwise.

Required production variables:

```bash
S3_BUCKET=<workbook-evidence-bucket>
S3_REGION=<aws-region-or-auto-for-r2>
S3_ENDPOINT=<optional-s3-compatible-endpoint>
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
```

Upload behavior:

1. The upload API computes `upload_file_sha256` before parsing or publishing.
2. When object storage is configured, the original workbook bytes are written to
   `workbooks/<entity>/<snapshot_id>/<sha256>-<safe-file-name>`.
3. The snapshot row stores `upload_file_path` as `s3://<bucket>/<key>` and keeps
   the SHA-256 in `upload_file_sha256`.
4. The `snapshot.create` audit entry records the storage URI, storage key, and
   whether object storage was used.
5. In production, uploads fail if required object-storage variables are missing.
   In local development, missing storage falls back to a `local-dev://` reference
   so parser and staging work can continue without credentials.

Verification:

1. Upload a small test workbook in preview.
2. Confirm the returned snapshot `file_sha256` matches the database
   `snapshots.upload_file_sha256`.
3. Confirm `snapshots.upload_file_path` starts with `s3://`.
4. Confirm the object exists in the configured bucket at the recorded key.
5. Remove the test workbook and snapshot only through an approved data-cleanup
   procedure; never commit uploaded workbooks or database dumps to the repo.

## Sentry Alerts

Set `SENTRY_DSN` in Vercel production and preview environments before launch.
Server initialization is a no-op when the DSN is absent.

Minimum alert routing:

- New production error issue: notify the launch owner and engineering owner.
- Error rate spike over 1% for 10 minutes: start incident triage.
- Repeated upload route exceptions: pause workbook uploads until the parser or
  storage failure is understood.
- Cron route exceptions: verify `CRON_SECRET`, recent deployment changes, and
  email rule activation state before retrying.

Triage steps:

1. Open the Sentry issue and identify route, release, environment, and first
   seen timestamp.
2. Check Vercel runtime logs for the same timestamp.
3. Confirm whether the failure created any partial database mutation. Use
   `audit_log` and snapshot status rather than raw workbook logs.
4. Apply rollback only if the issue is deployment-related and data state is
   understood.

## Rate-Limit Responses

API middleware returns HTTP 429 with:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

Clients should honor the `Retry-After` response header before retrying. Default
API traffic is limited to 100 requests per minute per IP and route. Workbook
upload is limited to 10 requests per minute. Email outbox processing is limited
to 5 requests per minute.

Operational response:

1. Confirm the blocked route and source IP from Vercel logs.
2. If traffic is legitimate, wait for token refill and retry.
3. If traffic is abusive or automated, add the source to the platform firewall
   or block upstream.
4. Do not bypass limits for workbook upload without confirming the parser and
   storage queues are healthy.

## Upload Rejection Codes

Workbook upload validation can reject before parsing with HTTP 400:

| Code | Meaning | Operator action |
|---|---|---|
| `TOO_LARGE` | File exceeds 25 MB. | Ask the analyst to export a smaller workbook or split the report. |
| `BAD_EXTENSION` | File extension is not `.xlsx`, `.xls`, or `.csv`. | Ask for an approved workbook or CSV export. |
| `BAD_MIME` | Browser-supplied MIME type is not allowed. | Re-export the workbook or confirm the source system generated the file. |

Parser row errors remain staged as `PARSE_ERROR`; upload validation failures do
not enter the parser pipeline.

## Error-Boundary Recovery

The page and root error boundaries show a calm recovery screen with a retry
button and home link. When `SENTRY_DSN` is configured, the boundary sends the
captured exception to Sentry.

Operator response:

1. Ask the user for the route, timestamp, and action that preceded the boundary.
2. Check Sentry for a matching issue and digest.
3. If retry succeeds, keep the incident open until the root cause is classified.
4. If retry fails, route the user to the home page and use the relevant API or
   database state to determine whether a mutation completed.

## OWASP Review Cadence

Review `docs/owasp-review.md` before production launch, after major auth/upload
changes, and at least quarterly. Open items must have an owner and target date
before launch promotion.
