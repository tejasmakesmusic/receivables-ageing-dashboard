# OWASP Production Hardening Review

Checklist date: 2026-05-07

| OWASP Top 10 area | Status | Receivables OS control |
|---|---|---|
| A01 Broken Access Control | Verified | Route handlers enforce RBAC for ANALYST, CFO, ADMIN, and PENDING users per PRD F-8. CFO and PENDING users remain blocked from publish and mutation paths. |
| A02 Cryptographic Failures | Mitigated | Production traffic is served over Vercel HTTPS. Secrets are expected in Vercel environment variables and must not be committed. |
| A03 Injection | Verified | Database access uses Prisma query APIs and parameterized operations rather than string-built SQL. |
| A04 Insecure Design | Mitigated | Publish, upload, parser, FX, and ageing guardrails are enforced server-side and documented in the locked spec and ADRs. |
| A05 Security Misconfiguration | Open | Production environment review must confirm HTTPS-only domains, Sentry DSN, object storage credentials, cron secrets, and least-privilege Vercel project access. |
| A06 Vulnerable and Outdated Components | Open | `npm audit` or equivalent dependency review should run before launch and during the regular review cadence. |
| A07 Identification and Authentication Failures | Mitigated | Google Workspace SSO and domain restriction are the production auth model; local development uses the stub admin flow only when configured. Session secret values must come from environment variables. |
| A08 Software and Data Integrity Failures | Verified | Workbook uploads are retained with SHA-256 metadata when object storage is configured. Mutations write audit log rows with before/after JSON. |
| A09 Security Logging and Monitoring Failures | Mitigated | Sentry instrumentation is available when `SENTRY_DSN` is set. Runbooks define alert handling and review cadence. |
| A10 Server-Side Request Forgery | Mitigated | Current user flows do not fetch arbitrary user-supplied URLs. Object storage requests use configured endpoints and credentials only. |

Additional checklist:

- RBAC: Verified in server route handlers and covered by existing tests.
- Secret handling: Mitigated by environment-variable configuration; no secrets belong in source control.
- Transport: Mitigated by Vercel HTTPS; confirm production domain settings before launch.
- SQL injection: Verified through Prisma parameterization.
- XSS: Mitigated by React escaping and server-rendered typed views.
- Upload validation: Verified through extension, size, and MIME checks before parsing.
- Rate limiting: Mitigated by middleware token buckets for API, upload, and email outbox routes.
- Audit log: Verified for mutation paths per project guardrails and existing tests.
- Session security: Mitigated by Google SSO and `SESSION_SECRET`; production cookie settings should be reviewed during launch signoff.
