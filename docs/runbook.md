# Runbook

Operational procedures for the Receivables Ageing Dashboard on Railway.

Populated as M1 deploys skeleton → M8 cuts over. Until then, intentionally
sparse. Sections to fill in:

- Deploy / rollback (Railway)
- DB migrations (`uv run alembic upgrade head`, rollback steps)
- Restoring from Railway backup + weekly `pg_dump`
- Resend / SendGrid failure mode (digest didn't fire, publish-notif stuck)
- APScheduler double-fire debug
- First-time admin seed (CLI)
- SPF / DKIM / DMARC verification for `emb.global`
- Google OAuth redirect URI rotation
- FX rate incident (rate set wrong → consolidated view mis-stated)
- Reconciliation mismatch (spec §13 consequence #6)

See also `02_HANDOFF_SPEC.md` §11 (non-functional requirements) and
§13 (consequences 9–16 — deployment-specific).
