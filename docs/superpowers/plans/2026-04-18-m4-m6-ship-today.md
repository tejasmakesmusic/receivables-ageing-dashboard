# M4–M6 + Frontend MVP — "ship today" plan

**Date:** 2026-04-18
**Branch:** `feature/m4-m6-ship-today` (off `main` after M3 merge)
**Gate lifted:** M2 wireframes approved by Tejaswa 2026-04-18. D23 gate open.
**Authorization:** user asked for full app "testable locally today" with a follow-up pass on low-risk-low-effort production items.

---

## Scope compression

Spec milestones M4/M5/M6 plus the frontend are normally weeks of work. For "today" we compress to a vertical slice — **the golden path runs end-to-end locally; everything else is stub or deferred.**

### Must-have (M4-MVP + M5-MVP + M6-MVP + frontend-core)

**Core loop:**
1. Login via SSO stub (`AUTH_PROVIDER=stub`) as ADMIN.
2. Upload a Tally XLSX → S1 page.
3. Staging review → S2 page; resolve aliases; create canonicals; override credit days; ack warnings.
4. Publish → invoices created, invoice_snapshots written, audit log entry.
5. Dashboard → D1 shows KPIs, ageing buckets, top-10 parties.

**Plus (one level deeper for a real demo):**
6. Exception tagging → S5 minimal UI: list invoices, tag as DISPUTED/CN_PENDING/etc.
7. Reconciliation → A6 minimal UI: pick snapshot, enter Tally AR, see delta.
8. Credit Period config → S3 minimal UI: list + create.

### Stubs (render but non-functional)

- Drill-down screens (D2 party, D3 invoice): route exists, page says "Details coming in M5."
- Follow-ups (S6): route exists, page says "Follow-up tracking coming in M5."
- Admin screens A2 (emails), A3 (exception buckets), A4 (FX rates), A5 (audit log): each a minimal list-only view. Write ops stubbed out.
- Alias mgmt (S4): minimal list of existing aliases. No inline edit yet.

### Deferred (explicitly out of scope for today — flagged for post-demo)

- Daily CFO digest cron (M6 SMTP, SPF/DKIM, Resend/SendGrid) — email_outbox ROWS are populated but no drain delivery. Needed: EMB IT ticket for DNS.
- SSO in production mode (works in stub; prod requires Google OAuth client ID + verified redirect URIs).
- Trend sparkline with real FX conversion for Consolidated view — backend writes native currency only; M4 does on-read FX, may be stubbed if FX rates not seeded.
- Material-change review banner on S5 — fires on backend (Task 5), not yet surfaced in UI.
- A6 permission model decision (D19 vs §9 contradiction) — hard-code ADMIN-writes for the MVP. Flip trivially later.
- Concurrent-publish race-test infra (xfail from M3 Task 5) — M7.
- M1 test-file mypy cleanup — M7.

---

## Backend work (dispatched as one Sonnet agent)

### M4 — dashboard endpoints

- `GET /dashboard?entity=IND|UAE|ALL&as_of=latest|YYYY-MM-DD` → KPI tiles + ageing bucket totals + top-10 parties-by-outstanding.
- `GET /parties/:canonical_id` → party summary + invoices list (M5 stub for UI).
- `GET /invoices/:invoice_id` → invoice detail + current exception tags + invoice_snapshots history.
- `GET /snapshots` → recent snapshots list (the Upload page shows this).
- FX lookup helper service for Consolidated view (per-invoice AED→INR conversion using `fx_rates` pinned by `invoice_date`).

### M5 — exceptions + follow-ups

- `POST /invoices/:invoice_id/exceptions` → create tag (ANALYST/ADMIN, entity-scoped). Body `{bucket_type_code, reason, expected_resolution_date?}`. Writes `exception_tags` + audit log.
- `PATCH /exceptions/:id` → resolve (status → RESOLVED, set `resolved_at/by/note`). Deleted/hard-resolved is ADMIN only per spec intent.
- `GET /invoices?filters=…` → filtered invoice list for S5. Supports filter by `bucket_type_code`, `status`, `entity_code`.
- `GET /exceptions?filters=…` → filtered exception list.
- `POST /invoices/:invoice_id/follow-ups` → stub endpoint returning 501 Not Implemented with message "follow-up tracking in M5 extension." S6 UI can live without it today.
- `POST /parties/:canonical_id/follow-ups` → same stub.

### M6-MVP — admin + reconciliation + FX rates

- `GET/POST /config/fx-rates` → add new FX rate (immutable per D15); list. ADMIN only. Seed one rate (AED→INR @ 22.50 effective 2026-01-01) for demo.
- `GET /admin/exception-buckets` → list seeded D9 + admin-added. `POST /admin/exception-buckets` → add new bucket type. `PATCH /admin/exception-buckets/:id` → toggle active. ADMIN only.
- `GET /admin/audit-log?filters=…` → paginated list. ADMIN only. Filter by actor, action, entity_type, date range.
- `GET /admin/email-rules` + `POST` + `PATCH` → stub: list `email_outbox` rows (SENT/QUEUED/FAILED) so analysts can see what would go out. No SMTP delivery today.
- `GET /snapshots/:snapshot_id/reconciliation` → fetch or compute current reconciliation_entry for the snapshot.
- `POST /snapshots/:snapshot_id/reconciliation` → set `tally_xero_closing_ar`, compute `delta = dashboard_ar + exception_bucket_total - tally_xero_closing_ar` (spec D19 formula), set status MATCHED/MISMATCHED. ADMIN writes (temporary decision pending D19-vs-§9 resolution — documented in wireframes/README.md).
- Publish gate bump: `POST /snapshots/:id/publish` adds a 6th gate: **prior snapshot must be reconciled** (if any prior snapshot exists for this entity and has status=PUBLISHED, its reconciliation_entry.status must be MATCHED). Non-match → 422 `PRIOR_SNAPSHOT_UNRECONCILED`. This is spec §13 #6.

### Nothing that requires DNS/SMTP

- `email_outbox` drain stays as a no-op. Rows stay QUEUED. M6-full (post-DNS) will add the drain worker.

---

## Frontend work (dispatched as one Sonnet agent after backend lands)

### Stack (already scaffolded per README)

React 18 + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router.

### Architecture

- `src/lib/api.ts` — typed fetch client, CSRF token handling, structured error mapping.
- `src/lib/auth.ts` — current-user store, `useCurrentUser` hook.
- `src/components/Shell.tsx` — top nav with entity selector + role badge + logout.
- `src/components/PendingPage.tsx` — awaiting-role landing.
- `src/components/ProtectedRoute.tsx` — role gate + redirect.
- Route tree driven by spec §9 codes: `/upload`, `/staging/:id`, `/dashboard`, `/party/:id`, `/invoice/:id`, `/exceptions`, `/follow-ups`, `/config/credit-period`, `/config/aliases`, `/admin/*`.
- Tailwind + shadcn/ui primitives (Button, Input, Table, Dialog, Card). No custom design system — mirror wireframes visually.

### Screen priority

1. **S1 Upload** — fully functional (drop zone, entity, as-of date, source auto-detect via /snapshots parse).
2. **S2 Staging** — fully functional (table, alias resolution chips, PATCH actions, publish button with gate status panel).
3. **D1 Dashboard** — fully functional (KPIs, ageing bars, top-10 table, entity pills).
4. **S5 Exceptions** — list + tag modal. No bulk actions.
5. **A6 Reconciliation** — fetch snapshot, input field, compute/display delta. ADMIN-only copy.
6. **S3 Credit Period** — list + add form.
7. **S4 Aliases** — list + add form.
8. **A4 FX Rates** — list + add (immutable) form.
9. **A3 Exception buckets** — list + add + activate toggle.
10. **A5 Audit log** — filtered list.

**Stubs** (route registered, minimal placeholder):
- D2 Party, D3 Invoice, S6 Follow-ups, A1 Users (already works from M1 Jinja page — may reroute through React or leave Jinja), A2 Emails (basic list of email_outbox).

### Build + test

- `cd frontend && npm install && npm run build` produces `dist/` bundle.
- Dockerfile's multi-stage `frontend-builder` target produces the same bundle and FastAPI serves via `StaticFiles` mount.
- At least one Vitest smoke test per critical screen (render + happy-path interaction).

---

## Sequencing

1. Wait for in-flight M3 full-suite test.
2. Merge M3 → main (local), push main.
3. Branch `feature/m4-m6-ship-today`.
4. **Backend dispatch** (one big Sonnet run) — all M4/M5/M6 endpoints + migration(s) + tests.
5. Commit backend. Confirm full suite still green.
6. **Frontend dispatch** (one Sonnet run) — scaffold + 10 screens + 6 stubs.
7. Commit frontend.
8. Local smoke test: `uv run uvicorn` + `cd frontend && npm run dev` → walk the golden path.
9. Produce `LOCAL_SETUP.md` with step-by-step instructions + flagged low-risk-low-effort prod items for the next pass.

---

## "Low-risk-low-effort" deployment items identified so far (the follow-up list)

Captured now so I don't forget them in the crunch:

1. **Q3/Q4 2026 partitions** for `invoice_snapshots` — one SQL statement each, per the runbook entry added in M3 Task 1. Calendar reminder for 2026-06-25.
2. **`AGENTS.md` untracked in repo root** — decide: commit it (Codex guardrails) or `.gitignore` it.
3. **Flip `AUTH_PROVIDER=google`** in Railway env — requires Google OAuth client ID + verified redirect URI + testing. ~30 min if credentials are ready.
4. **M1 test-file mypy cleanup** (32 errors not in CI's mypy scope) — cosmetic, maybe an hour.
5. **Seed one real FX rate** (AED→INR) in production Neon DB — single `POST /config/fx-rates` via ADMIN. Needed before first UAE publish.
6. **Railway Pro** upgrade — payment + click. Needed for no-sleep daily digest (M6-full).
7. **Custom domain** (`ar.emb.global`) pointed at Railway — DNS change. Railway auto-issues HTTPS.
8. **First canonical + alias seed** for top 20 parties (to shortcut alias resolution on first snapshot) — a CSV import via `/config/aliases` POST.
9. **Backup cron** — Railway's built-in is fine for local; add weekly `pg_dump` to S3 when off Hobby.
10. **Concurrent-publish race-test infra** (M3 xfail) — M7 hardening, not production.
11. **SPF/DKIM for `emb.global`** — EMB IT ticket. Real blocker for email. Can't self-service.

---

## Non-goals (today)

- Polish, animations, mobile-responsive beyond the wireframe layouts.
- Dark mode.
- I18n.
- Storybook / component tests beyond smoke tests.
- ALL of M6's daily digest pipeline (cron + SMTP + template rendering).
- Performance/load testing.

---

## Reference

- Spec: `02_HANDOFF_SPEC.md`
- M2 wireframes: `wireframes/*.html` (approved 2026-04-18)
- M3 ingestion commits: `f879e14..976bfb6` on `feature/m3-ingestion`
- Prior plans: `docs/superpowers/plans/2026-04-16-m1-foundations.md`, `2026-04-17-m2-parsers-wireframes.md`, `2026-04-17-m3-ingestion-pipeline.md`
- ADRs: `docs/adr/0001-*.md` through `0004-*.md`
