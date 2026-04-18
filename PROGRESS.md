# Project progress snapshot

**As of 2026-04-19.** Canonical in-repo record of everything shipped so far. Skim this to re-orient after a break; use `git log --oneline` for the authoritative history.

---

## One-line summary

Receivables Ageing Dashboard — ingestion pipeline, dashboard, exceptions, admin, reconciliation, and full React frontend — **local-demo-ready vertical slice** merged to `main` and pushed (`origin/main @ 2ff2c5e`).

---

## Milestone status

| # | Scope | Status | Notes |
|---|---|---|---|
| M0 | Repo scaffold (monorepo, Dockerfile, Railway config, CI skeleton) | ✅ | `c6fba91` |
| M1 | Foundations — DB, Google SSO (stub toggle), RBAC, Admin UI, Railway deploy skeleton | ✅ | 49 commits, merged 2026-04-17 |
| M2 | Parsers (Tally / Xero / Credit Period) + ageing calc + wireframes | ✅ | merged + wireframes approved 2026-04-18 (D23 gate lifted) |
| M3 | Ingestion pipeline — upload → stage → alias match → publish | ✅ | 635 tests at merge |
| M4-MVP | Dashboard, party/invoice drill-downs (stubs for rich pages) | ✅ | vertical slice |
| M5-MVP | Exception CRUD; follow-ups stubbed (table exists, 501 endpoints) | ✅ | vertical slice |
| M6-MVP | FX rates, admin screens, reconciliation, `email_outbox` drain stub, §13 #6 prior-publish gate | ✅ | vertical slice |
| Frontend | React 18 + Vite + Tailwind + Router + Query; 16 pages; 58 vitest | ✅ | 304 kB JS / 89 kB gzipped |
| M5-full | D2/D3 rich drill-downs, S6 follow-up CRUD UI, material-change banner on S5 | ⏳ | deferred |
| M6-full | SMTP delivery, daily CFO digest cron, A6 permission contradiction resolution | ⏳ | deferred (SPF/DKIM blocker) |
| M7 | Hardening — RBAC sweeps, race-test infra, mypy cleanup on test files | ⏳ | deferred |
| M8 | Production cutover — DNS, Railway Pro, Google OAuth client, first live snapshot | ⏳ | deferred |

---

## Current commit

```
2ff2c5e Merge M4-M6 ship-today — dashboard, exceptions, admin, reconciliation + full React frontend
```

`origin/main` matches. Zero unpushed commits.

---

## Architecture decisions (recorded in `docs/adr/`)

| # | Title | Summary |
|---|---|---|
| 0001 | Record architecture decisions | Process ADR. |
| 0002 | Use Neon for Postgres | Neon replaces Railway-managed Postgres (D21 clause overridden). Pooled + direct DSNs. Per-test ephemeral branches. |
| 0003 | Tally grand-total reconciliation | Original sum-of-invoices vs grand-total check demoted to per-row classification completeness + non-blocking warning. Addendum further clarified after 2-layer Tally netting discovery. |
| 0004 | Xero grand-total reconciliation | Same pattern as ADR-0003; Xero's Aged Receivables Detail grand total reflects overdue exposure, not sum of invoice totals. `GRAND_TOTAL_MISMATCH` is a warning. |

---

## What exists in the codebase

### Backend

| Area | Count |
|---|---|
| Alembic migrations (`backend/alembic/versions/`) | 7 (`0001_initial` → `0007_reconciliation_entries_and_follow_ups`) |
| SQLAlchemy 2.0 models (`backend/src/app/db/models/`) | 14 (entity, user, fx_rate, audit_log, snapshot, party_canonical, party_alias, credit_period_config, invoice, invoice_snapshot, exception_bucket_type, exception_tag, email_outbox, reconciliation_entry, follow_up) |
| pydantic v2 schemas (`backend/src/app/schemas/`) | 13 (snapshot, staging, publish, discard, config, dashboard, party, invoice, exception, fx_rate, admin, reconciliation) |
| Service modules (`backend/src/app/services/`) | 13 (ageing, snapshot, staging, alias_resolver, source_detect, partition_check, publish, discard, config, dashboard, exception, fx_conversion, reconciliation) |
| API route modules (`backend/src/app/api/routes/`) | 9 (auth, admin, config, snapshots, dashboard, exceptions, follow_ups, invoices, parties) |
| Parsers (`backend/src/app/parsers/`) | 3 (tally, xero, credit_period) + common.py |
| Integration tests | 23 files, ~400 cases |
| Unit tests | 22 files, ~360 cases |

### Frontend

| Area | Count |
|---|---|
| Pages (`frontend/src/pages/`) | 16 (Login, Pending, NotFound, S1–S6 + D1–D3 + A2–A6) |
| UI primitives (`frontend/src/components/ui/`) | 9 (Button, Badge, Card, Input, Textarea, Select, Skeleton, Modal, Pagination) |
| Hooks / layout / routing | useCurrentUser, ProtectedRoute, Shell, App router tree |
| Vitest test files | 9 files, 58 cases |
| Build output | `frontend/dist/` — 304 kB JS, 21 kB CSS (Vite + TS) |

### Docs

| File | Purpose |
|---|---|
| `02_HANDOFF_SPEC.md` | Locked spec (D1–D23 + §13 consequences). |
| `01_brainstorm_screens_and_features.md` | Rationale. |
| `03_CLAUDE_CODE_BOOTSTRAP_PROMPT.md` | Original bootstrap. |
| `CLAUDE.md` | Guardrails. |
| `AGENTS.md` | Codex guardrails (untracked — decide commit-or-ignore). |
| `README.md` | Bring-up + milestone status + env vars. |
| `LOCAL_SETUP.md` | End-to-end smoke-test walkthrough + 13-item prod checklist. |
| `PROGRESS.md` | This file. |
| `docs/runbook.md` | Ops runbook (partitioning, etc.). |
| `docs/adr/` | 4 ADRs. |
| `docs/superpowers/plans/` | 5 implementation plans. |
| `docs/superpowers/specs/` | M1 design spec. |
| `wireframes/` | 5 HTML+Tailwind mockups + README (approved 2026-04-18). |

---

## Spec decisions exercised

| Decision | Implementation evidence |
|---|---|
| D1 — Python/FastAPI + React + Postgres | Entire stack. |
| D2 — Snapshot + upsert, match key `(entity_id, canonical_party_id, invoice_ref)` | `publish_service.publish_snapshot` |
| D3 — IND + UAE entities | M1 seed + entity-scoped routes throughout |
| D4 — Google SSO, `@emb.global` only | `auth.py` + stub toggle |
| D5 — Roles ANALYST/CFO/ADMIN/PENDING | `require_role` dep + service-layer entity scope |
| D6 — NOT_DUE / 0_30 / 31_60 / 61_90 / 90_PLUS | `AgeingBucket` enum + ageing calc |
| D7 — `due_date = invoice_date + credit_days` | `compute_ageing` + publish service |
| D8 — Credit days priority: config → default → manual | `publish_service._resolve_credit_days_for_invoice` |
| D9 — Pre-seeded exception buckets (LEGAL / DISPUTED / CN_PENDING / WRITTEN_OFF) | Alembic 0003 seed |
| D10 — Exception persistence + AUTO_RESOLVED on settlement | §13 #1 cascade in publish service |
| D11 — Fuzzy matching thresholds 70/90 | `alias_resolver.resolve_alias` |
| D12 — Follow-up tracking (structured) | Table exists (migration 0007); CRUD UI deferred |
| D13 — Daily digest + publish notif | `email_outbox` rows populated; drain deferred to M6-full |
| D14 — No historical backfill | Enforced by upload state machine |
| D15 — FX rates immutable | ORM `before_flush` hook + Postgres trigger + partial unique index (M1) |
| D16 — Write-off classification only (no JE trigger) | Exception bucket type WRITTEN_OFF |
| D17 — Publish override (ADMIN only) | `published_as=OVERRIDE` in publish service |
| D18 — Digest in IST only | Deferred to M6-full |
| D19 — Reconciliation formula | `reconciliation_service` implements `Dashboard AR + Exception buckets − Tally/Xero AR` exactly |
| D20 — UAE credit period Amount column dropped | Credit Period parser never reads it |
| D21 — Railway hosting | Dockerfile + railway.json + `scripts/start.sh` |
| D22 — Resend OR SendGrid | Both deps installed; provider selectable via `EMAIL_PROVIDER` |
| D23 — Wireframes before M4 React build | Satisfied; wireframes approved 2026-04-18 |

---

## Known gaps + flagged items

| Item | Where noted | Owner |
|---|---|---|
| A6 permission contradiction (D19 says analyst writes; §9 says ANALYST read, ADMIN write) | `wireframes/README.md § Open spec questions` | Tejaswa — needs spec call before M6-full |
| Tally 2-layer netting (party + group) | ADR-0003 addendum | Resolved in code via classification-completeness safety net |
| Xero overdue-only grand total | ADR-0004 | Resolved via `GRAND_TOTAL_MISMATCH` demoted to warning |
| `AGENTS.md` untracked | Repo root | Tejaswa — commit it or `.gitignore` it |
| `test_concurrent_publish_serialised_via_row_lock` xfail | `test_snapshots_publish.py` | M7 — needs per-thread engine fixture infra |
| M1 test-file mypy errors (32) | `backend/tests/unit/`, `integration/` | M7 — not in CI scope today |
| Q3/Q4 2026 partitions not yet created on `invoice_snapshots` | `docs/runbook.md § Partitioning invoice_snapshots` | Tejaswa — manual SQL before 2026-06-25 |
| Stub auth in prod-mode startup guard not implemented | `config.py` docstring references missing `app/core/startup.py` | M6-full or pre-cutover |
| SPF / DKIM for `emb.global` | LOCAL_SETUP.md item 13 | EMB IT ticket — blocker for email delivery |
| Railway Pro upgrade | LOCAL_SETUP.md item 6 | Tejaswa — billing action |

---

## Remote state

| Branch | Remote | Notes |
|---|---|---|
| `main` | `origin/main @ 2ff2c5e` | Authoritative. Matches local. |
| `feature/m1-foundations` | `origin/feature/m1-foundations` | Merged via PR #1. Safely deletable. |
| `feature/m2-parsers-wireframes` | `origin/feature/m2-parsers-wireframes` | Merged via local fast-forward. Safely deletable. |

Both local feature branches have been deleted. Remote copies remain as audit history; delete them whenever.

---

## Test counts (reference)

| Suite | Count |
|---|---|
| Backend integration | ~400 |
| Backend unit | ~360 |
| Frontend vitest | 58 |
| **Total** | **~820** |

Last full-suite run (before the 6-test fix): 798 passed / 2 skip / 1 xfail / 7 fail (all 7 failures spec-correctly caused by the new §13 #6 gate; fixed in `d73cf73`).

---

## Next steps (when ready)

From `LOCAL_SETUP.md` — roughly in time order:

1. Walk the golden path locally (5 min): `LOCAL_SETUP.md § Run it`.
2. Commit-or-ignore `AGENTS.md` (30 seconds).
3. Seed Q3/Q4 2026 partitions (5 minutes — SQL in runbook).
4. Pre-seed top-20 party aliases (15-30 minutes — CSV import via `/config/aliases` POST).
5. Flip `AUTH_PROVIDER=google` after Google Cloud Console setup (30 minutes).
6. File EMB IT ticket for SPF / DKIM on `emb.global` (DNS lead time; file now).
7. Upgrade Railway to Pro (1 minute + billing).
8. Deploy to Railway via `git push origin main` (already done — Railway auto-deploys) + verify `/health`.
9. Seed first AED→INR FX rate via `/admin/fx-rates` (2 minutes, ADMIN).
10. Custom domain `ar.emb.global` + HTTPS (30 minutes incl. DNS propagation).
11. Weekly `pg_dump` cron to S3 or GitHub artifact (15 minutes).
12. M1 test-file mypy cleanup (1 hour — cosmetic).
13. Stub-in-prod startup guard (1 minute defensive code).
14. First live snapshot + 1-week monitor before CFO access.

---

## How to get un-stuck

- **Lost?** Start at `README.md`, then `LOCAL_SETUP.md`, then this file.
- **Spec question?** `02_HANDOFF_SPEC.md` §2 (decisions) and §13 (consequences).
- **"Why does it do X?"** Search `docs/adr/` first.
- **Test setup pain?** `backend/tests/conftest.py` explains the Neon-branch-per-session fixture. If tests 422 on branch create, delete stale branches (see `LOCAL_SETUP.md § Production readiness` item 13 for the curl loop).
- **UI doesn't match wireframe?** Compare `frontend/src/pages/XPage.tsx` to `wireframes/X*.html`. Wireframes are visual truth (approved 2026-04-18).
- **Need to add a new migration?** `uv run alembic -c backend/alembic.ini revision -m "name"`. Keep `down_revision` pointing at the prior head; verify with `test_migrations.py::test_migration_files_parse`.
