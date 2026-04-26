# ADR-0005 — Credit Period snapshot publish writes versioned configs

**Date:** 2026-04-19
**Status:** Accepted
**Context milestone:** M6-MVP extension (publish CREDIT_PERIOD snapshots — originally deferred as "Task 6")
**Related:** spec §3, §4.3, §5, §13 #5; ADR-0003/0004 (Tally/Xero reconciliation); this repo's prior short-circuit at `publish_service.py:302`.

## Context

Until today, `publish_service.publish_snapshot` hard-coded a 422 for `source_hint == "CREDIT_PERIOD"` with a `CREDIT_PERIOD_PUBLISH_NOT_IMPLEMENTED_YET_SEE_TASK_6` error. CP snapshots could be uploaded and staged but never produced any `credit_period_config` rows, so the D8 priority chain (CONFIG → entity DEFAULT → MANUAL) couldn't use CP values at publish time for Tally/Xero snapshots. The only way to make invoices publishable was to set `entities.default_credit_days` (ADR outside scope) or per-row manual overrides.

This ADR records the three behavior decisions for CP publish so future changes are reviewable against a single source of truth.

## Decisions

### D1 — Canonical resolution (auto-create if missing)

When a CP row lists a client name that has no existing `parties_canonical` row for that entity, publish **creates** the canonical + a MANUAL alias (alias_text == the CP client name). Mirrors the Tally/Xero staging path (spec §4 step 3) and the bulk-create-canonicals endpoint.

Rationale:
- CP master and invoice-side aliases are often curated separately; forcing the CP master to pre-exist in the alias graph would block most first-time publishes.
- MANUAL aliases are idempotent on re-upload (`UNIQUE(alias_text, canonical_id)`); no data drift.
- Analyst can later merge canonicals via `/admin/aliases` if they discover that a CP-master client and a Tally-side canonical are the same entity.

### D2 — Versioning window (`valid_from` = snapshot.as_of_date, `valid_to` = NULL)

Each CP row produces a `credit_period_config` with:
- `valid_from = snapshot.as_of_date` (the date the master is considered effective).
- `valid_to = NULL` (open-ended).

On a subsequent CP publish for the same canonical with a different value, the prior open row is **superseded**: its `valid_to` is set to `new_snapshot.as_of_date - 1 day` before the new row is inserted.

Rationale:
- Matches the spec §4.3 rule 5 language verbatim.
- Keeps time-travel consistent with invoice snapshots (which are keyed on `as_of_date` too).
- The `valid_to = as_of_date - 1` supersede convention is what ageing queries assume when picking the applicable config for an invoice dated in the past.

### D3 — Idempotency policy

On a CP row whose `(canonical_id, days, reason_note)` exactly matches the currently active config, publish does **no-op** — no INSERT, no UPDATE. Counts as `credit_period_configs_noop`.

If `days` or `reason_note` differ from the active config, **supersede** (close old, insert new). Counts as `credit_period_configs_superseded`.

If no active config exists, **insert** a new row. Counts as `credit_period_configs_inserted`.

Rationale:
- Re-uploading the same CP master is common (monthly refresh, typo correction, adding new clients). No-op on unchanged rows keeps the audit log and version history free of churn.
- Genuine changes (a client's terms moved from 30 → 45) get a clean audit trail via the supersede pattern.
- `reason_note` is part of the identity check so that a note-only edit still produces a new row (the note is business-relevant, not cosmetic).

## Consequences

**Positive:**
- Tally/Xero invoices can now resolve credit_days from CP configs (priority 1 in D8) instead of only from entity defaults or manual overrides.
- CP master re-uploads are safe — existing rows are preserved, changed rows are versioned, unchanged rows are no-ops.
- Analysts don't need to manually link CP master client names to existing canonicals before the first publish.

**Negative / trade-offs:**
- Auto-creating canonicals from CP master can produce "orphan" canonicals that have a CP config row but no invoice. These are harmless but clutter `/admin/aliases`. Mitigation: the analyst can review and merge via the existing ADMIN alias PATCH flow.
- A typo in a CP master client name creates a second canonical. No auto-detection. Mitigation: the `DUPLICATE_CLIENT` parser error (strict; per ADR-0003 pattern) catches intra-file dups; cross-snapshot dups are a human review concern.

**Load-bearing for downstream:**
- Publish service adds a branch at the existing `source_hint == "CREDIT_PERIOD"` check — removes the 422 short-circuit.
- `PublishResult` schema adds CP-specific counters (`credit_period_configs_inserted`, `credit_period_configs_superseded`, `credit_period_configs_noop`, `canonicals_auto_created`, `aliases_auto_created`).
- `email_outbox` PUBLISH_NOTIF email body lists CP counters alongside invoice counters when the snapshot is CP.
- CP staging UI (currently a stub) surfaces a read-only rows table so the analyst can review before clicking Publish. Staging CRUD on CP rows (edit days / dismiss row) is deferred as a separate task.

## Alternatives considered

- **Auto-match CP clients to existing canonicals by fuzzy similarity.** Rejected: too much false-positive risk (corporate suffix inflation — same issue analysts saw in the Tally publish flow); analysts should curate cross-source identity explicitly via `/admin/aliases`.
- **Let analyst set `valid_from` / `valid_to` per row at publish time.** Rejected: most uploads are "effective as of upload date"; per-row edits belong in staging (future work), not at the publish boundary.
- **Always INSERT a new row on publish (no no-op).** Rejected: floods `credit_period_config` with identical superseded rows on every monthly re-upload; history becomes noise.
