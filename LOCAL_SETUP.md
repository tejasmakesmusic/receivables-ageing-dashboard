# Local setup — end-to-end smoke test

Bring up the full stack (backend + frontend) on your laptop and walk the golden path. Stub SSO gives you an ADMIN user automatically — no Google OAuth configuration needed for local.

---

## Prerequisites (one-time)

| Tool | Version | Install |
|---|---|---|
| `uv` | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python | 3.12 | managed by `uv` |
| Node | 22 LTS | `nvm install 22 && nvm use 22` |
| Neon account | — | https://neon.tech — free tier fine |

The Neon project (`square-flower-64017520`) is already configured; DSNs in `.env`.

---

## First-time bring-up

From repo root:

```bash
# 1. Python deps
uv sync

# 2. Frontend deps
cd frontend && npm install && cd ..

# 3. Confirm .env has stub auth enabled (already the default)
grep "AUTH_PROVIDER" .env  # expect AUTH_PROVIDER=stub (or absent → stub)

# 4. Apply migrations (creates all tables on the Neon production branch)
uv run alembic -c backend/alembic.ini upgrade head
# Expected: seven migrations apply (0001 … 0007). Ends with "Running upgrade …".
```

## Run it

Two terminals.

**Terminal 1 — backend:**

```bash
uv run uvicorn app.main:app --reload --app-dir backend/src
# Listens on http://localhost:8000
# Stub auth + dev session cookies; no Google OAuth client needed
```

**Terminal 2 — frontend:**

```bash
cd frontend && npm run dev
# Listens on http://localhost:5173
# Vite proxies all /auth/*, /snapshots/*, /config/*, etc. to :8000
```

Open **http://localhost:5173/** in Chrome/Firefox. The app redirects to `/auth/google/login`; the stub handler creates (or reuses) an ADMIN user and bounces you back with a session cookie. You land on `/dashboard`.

---

## Golden path (the one-click tour)

Takes ~3–5 minutes manual. Demonstrates every locked decision.

### 1. Seed an FX rate (required for Consolidated view)

- Nav → `/admin/fx-rates`
- Click **Add rate**
  - From: `AED`
  - To: `INR`
  - Rate: `22.50`
  - Valid from: today's date
  - Notes: `demo seed rate`
- Save. The row is immutable (D15) — no edit/delete buttons.

### 2. Upload a Tally snapshot

- Nav → `/upload`
- Entity pill: **IND**
- Upload-type: **Transactional snapshot**
- As-of date: pick a date that falls in an existing partition (2026-Q1 or 2026-Q2, i.e. anywhere in Jan–Jun 2026). Use `2026-03-31` for safety.
- Source: auto-detect (or pick TALLY explicitly)
- Drop: `backend/tests/fixtures/sample_files/GrpBills.xlsx` (real client data, gitignored)
- Click **Pre-flight + Upload**

Expected: 201 with snapshot_id, redirected to `/staging/:snapshot_id`. The snapshot is in STAGED. ~290 OK invoices + warnings (GRAND_TOTAL_MISMATCH non-blocking per ADR-0003, UNALLOCATED_CREDITS_DELTA advisory, SUBTOTAL_MISMATCH per-party).

### 3. Resolve aliases

On the staging page:
- Unmapped rows show the raw party name with a **Create canonical** button.
- Fuzzy rows (70–89%) show a top-3 suggestion — click **Confirm match** on the correct one.
- For the first upload everything will be UNMAPPED (no alias master yet). For time, pick **Create canonical** on every row and accept the defaults (canonical_name = party_name_raw, alias_text = party_name_raw).

Watch the publish-gate panel at the top update as you resolve rows.

### 4. Ack warnings

Click **Acknowledge** on each warning in the Warnings panel. They turn green.

### 5. Publish

When all four gates are green (aliases / warnings / parse_errors / role), click **Publish**.

Expected: 200, snapshot transitions to PUBLISHED, redirect to `/dashboard`.

### 6. Dashboard

- KPIs populate: total outstanding, % overdue, parties with 90+ exposure.
- Ageing bar shows the bucket split.
- Top 10 parties clickable → `/party/:id` (stub for now).
- Entity pill → **Consolidated** converts AED to INR using the rate you seeded.
- If you skipped the rate: Consolidated shows a 422 FX_RATE_MISSING error with a link back to `/admin/fx-rates`.

### 7. Tag an exception

- Nav → `/exceptions`
- Find an invoice. Click **Tag exception**.
- Bucket: **DISPUTED**, reason: `demo — client disputes amount`, expected resolution: 30 days out.
- Save. The row appears with a yellow ACTIVE badge.

### 8. Reconcile the snapshot

- Nav → `/admin/reconciliation`
- Pick the snapshot.
- Dashboard AR + Exception total are computed.
- Enter Tally/Xero closing AR = Dashboard AR + Exception total (so delta = 0).
- Save. Status flips to **MATCHED**.

### 9. Upload a second snapshot

Go back to `/upload`. Drop `GrpBills.xlsx` again (or modify the date + pick a later as-of). Publish.

If the first snapshot wasn't reconciled in step 8, the second publish will 422 with `PRIOR_SNAPSHOT_UNRECONCILED` — this is the spec §13 #6 guardrail.

### 10. Admin screens

- `/admin/audit-log` — every mutation you just made is logged with actor + before/after JSON.
- `/admin/emails` — empty for now; SMTP is deferred. The publish notifications queue here.
- `/admin/exception-buckets` — D9 seed (LEGAL / DISPUTED / CN_PENDING / WRITTEN_OFF) + any you add.

---

## Known quirks

- **Partition coverage:** `invoice_snapshots` is partitioned by `as_of_date` quarterly. Only 2026-Q1 (Jan–Mar) and 2026-Q2 (Apr–Jun) partitions exist. Uploading with `as_of_date` outside this range 422s with `MISSING_PARTITION`. Fix: run the partition-creation SQL in `docs/runbook.md` under "Partitioning invoice_snapshots." Also applicable to Q3/Q4 2026 when those roll around.
- **CSRF:** the backend sets `csrf_token` cookie; the frontend mirrors it in the `X-CSRF-Token` header on every mutating request. If you see 403 on POST/PATCH/DELETE, check cookies are present (`document.cookie` in DevTools).
- **Tally has no as_of_date:** you MUST supply one on the upload form. Xero sniffs from row 2 but you can override.
- **A6 permission copy:** currently ADMIN-only writes — spec contradiction flagged in `wireframes/README.md` open-spec-questions. Either flip D19 or flip §9 before M6 ships.
- **One flaky test:** `test_batch_10k_aliases_sub_second` is `@pytest.mark.slow` and threshold 2s; occasionally exceeds in full-suite runs under CI contention. Skip with `-m "not slow"`.

---

## Run the backend tests

Fast (unit + mocked, no DB):
```bash
uv run pytest backend/tests/unit -q -m "not slow"
```

Full (integration — creates a Neon branch per pytest session):
```bash
uv run pytest backend/tests/ -q -p no:randomly
# ~45 min. 798 passed, 2 skipped, 1 xfailed expected.
```

## Run the frontend tests

```bash
cd frontend
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint
npm run test       # vitest — 58 tests
npm run build      # produces dist/
```

---

## Production readiness — low-risk / low-effort items

Worth knocking out in one short sitting when you're ready for the first live snapshot. None of these require external vendor dependencies beyond what's already configured.

### 1. Commit-or-ignore `AGENTS.md` (30 seconds)

The repo root has `AGENTS.md` (Codex guardrails) as an untracked file. Decide:
- Commit it for shared guidance: `git add AGENTS.md && git commit -m "docs: add AGENTS.md guardrails mirror"`
- Or add `AGENTS.md` to `.gitignore` if it's personal.

### 2. Create Q3/Q4 2026 partitions (5 minutes)

Before 2026-06-25, run the DDL in `docs/runbook.md § Partitioning invoice_snapshots`. The check is fast; the partition create is fast; tests catch mistakes instantly. Automating this cron is M6 work; manual suffices through year-end 2026.

### 3. Seed top-20 party aliases from prior uploads (15–30 minutes)

Instead of resolving UNMAPPED parties one-by-one at first demo, pre-seed `parties_canonical` + `party_aliases` for the top 20 parties by volume. Either:
- Upload once + resolve in staging + use that resolved state as the golden data set.
- Direct `INSERT` via `/config/aliases` POSTs (scriptable from `backend/tests/fixtures/sample_files/GrpBills.xlsx` distinct party names).

This cuts first-real-upload review time from ~30 min to ~5 min.

### 4. Flip `AUTH_PROVIDER=google` (30 minutes)

1. Google Cloud Console → create OAuth client (Web application).
2. Authorized redirect URIs: `https://<railway-domain>/auth/google/callback`.
3. Set `.env` (or Railway env vars): `AUTH_PROVIDER=google`, `GOOGLE_OAUTH_CLIENT_ID=...`, `GOOGLE_OAUTH_CLIENT_SECRET=...`, `GOOGLE_OAUTH_ALLOWED_DOMAIN=emb.global`.
4. Smoke-test by signing in as yourself → land on `/pending` (first login) → run `/admin/users` from stub-admin to approve yourself to ADMIN (one-time bootstrap).

### 5. Seed one real FX rate (AED→INR) (2 minutes)

As ADMIN, `/admin/fx-rates` → add today's rate. Rows immutable per D15; you'll add a new row monthly rather than editing.

### 6. Railway Pro plan (1 minute + billing)

Free tier sleeps the service after inactivity → breaks the 9 AM IST daily digest (when M6 ships). $20/mo bumps this. Do now; M6 delivery cron will land on a healthy platform.

### 7. Weekly `pg_dump` backup cron (15 minutes)

Neon's automated backups are solid but provider-locked. Add a GitHub Actions cron:
- Every Sunday 02:00 UTC.
- `pg_dump $DATABASE_URL_DIRECT > backup-$(date +%F).sql.gz`.
- Upload to an S3 bucket or GitHub release artifact.

Portable + cheap. Decouples you from Neon if you ever migrate.

### 8. Custom domain on Railway (30 minutes incl. DNS propagation)

`ar.emb.global` CNAME → Railway-provided `*.up.railway.app`. Railway auto-issues HTTPS cert via Let's Encrypt. Update `APP_BASE_URL` + `GOOGLE_OAUTH_REDIRECT_URI` once live.

### 9. M1 test-file mypy cleanup (1 hour)

32 mypy errors in `backend/tests/unit/test_*.py` and `backend/tests/integration/test_*.py` — pre-existing from M1. Not in CI scope (`files = ["backend/src"]`), so no block, but worth tidying for contributor comfort.

### 10. Commit-or-push-main gate (immediate)

M2 wireframe fixes at `9bf95bb` are local on `main` but never pushed. Push `main` once the M4-M6 branch lands there too:

```bash
git checkout main
git merge --no-ff feature/m4-m6-ship-today
git push origin main
```

### 11. SSO stub hardening (1 minute, defensive)

Before production cutover, add a startup guard that refuses to boot with `APP_ENV=production` AND `AUTH_PROVIDER=stub`. (M1 left a TODO for this; the comment in `config.py` references `app/core/startup.py` that doesn't exist yet.) Prevents a catastrophic "forgot to flip" deploy.

### 12. Concurrent-publish race-test infra (M7 hardening — defer)

Currently `test_concurrent_publish_serialised_via_row_lock` is `xfail`. The production SELECT FOR UPDATE lock is correct and also exercised sequentially by `test_publish_twice_returns_409`. Set up per-thread engine fixtures against a dedicated non-branched Postgres (e.g. Railway's own instance as a test DB) — not local-blocking, just M7 polish.

### 13. SPF / DKIM for `emb.global` (EMB IT ticket)

Hard blocker for M6's email delivery (daily CFO digest + publish notifications). Not low-effort — depends on EMB IT turnaround. File the ticket now so propagation catches up to your M6 work window.

---

## What's NOT in this MVP

These land in subsequent milestone work:

- **Drill-downs** `/party/:id` and `/invoice/:id` — currently stubs. M5 polish.
- **Follow-ups** `/follow-ups` — stub page + 501 endpoints. Table exists via migration 0007; M5-full adds CRUD.
- **SMTP delivery** — `email_outbox` rows accumulate; no send. M6-full after DNS is ready.
- **Daily CFO digest cron (9 AM IST)** — M6-full. Needs SPF/DKIM + Railway Pro first.
- **Material-change review banner on S5** — backend flags it; UI surfaces the flag only as a count on Dashboard. S5 richer UI is M5 polish.
- **FX multi-period trend** — Dashboard currently does per-invoice FX conversion only. Trend sparkline uses native currency; Consolidated trend is M4 polish.

---

## Reference

- Spec: `02_HANDOFF_SPEC.md`
- Wireframes: `wireframes/*.html`
- ADRs: `docs/adr/`
- M3 plan: `docs/superpowers/plans/2026-04-17-m3-ingestion-pipeline.md`
- M4-M6 ship-today plan: `docs/superpowers/plans/2026-04-18-m4-m6-ship-today.md`
- Partitioning runbook: `docs/runbook.md § Partitioning invoice_snapshots`
