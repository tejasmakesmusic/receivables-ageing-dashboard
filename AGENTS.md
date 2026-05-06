# Codex - Project Guardrails

## Source Of Truth

- `02_HANDOFF_SPEC.md` is the locked functional spec. Do not edit it without
  Tejaswa's explicit approval.
- ADRs in `docs/adr/` record approved technical deviations from the locked spec.
- Current runtime stack is Next.js 16, React 19, TypeScript, Prisma 7, Neon,
  Tailwind CSS 4, Vercel.

## Before Every Session

1. Read `02_HANDOFF_SPEC.md` section 2 and section 15.
2. Check `docs/adr/` for current architecture decisions.
3. Check `README.md` and `PROGRESS.md` for current implementation state.

## Never Do These

- Commit `.env`, OAuth secrets, SMTP keys, database dumps, or client data.
- Edit `02_HANDOFF_SPEC.md` without approval.
- Invent credit-period defaults.
- Auto-backfill historical data.
- Mutate FX rows after creation.
- Use Tally `overdue_days` or `due_on` for ageing.
- Use wall-clock today for ageing; use snapshot `as_of_date`.
- Let CFO or PENDING users publish or mutate.
- Drop parser errors silently.
- Persist the UAE credit-period `Amount` column.
- Send CFO emails before the rule is explicitly activated.

## Always Do These

- Use `npm`; do not introduce yarn or pnpm.
- Keep Prisma client initialization lazy for build-safe Next modules.
- Enforce RBAC in route handlers.
- Write `audit_log` rows for every mutation with before/after JSON.
- Stage parser row errors as `PARSE_ERROR`.
- Pin FX lookup by `invoice_date`.
- Keep server code type-safe and avoid leaking raw invoice data to logs.

## Verification

Before claiming work is complete, run the relevant commands:

```bash
npm run typecheck
npm run lint
npm run build
```

If tests are added, include them in the verification path.
