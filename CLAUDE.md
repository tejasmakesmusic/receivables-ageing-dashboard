# Claude Code - Project Guardrails

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

## Codex Workflow

- Use `codex:codex-rescue` agent for all implementation phases to maximize token efficiency.
- **Windows spawn fix (applied):** `SpawnedCodexAppServerClient.initialize()` in `app-server.mjs` passes `shell: process.platform === "win32"` so the `codex.cmd` npm shim is found on Windows. `ENOENT` errors now log a clear install hint before calling `handleExit` — the direct implementation path is preserved and not blocked if Codex spawn fails.
- After each phase, run a `superpowers:code-reviewer` agent for a codebase review before moving to the next phase.

## Architecture Conventions

- Shell components: `src/components/shell/` — `AppShell` is a Server Component; `Sidebar` + `ModeToggle` are `'use client'`.
- Ageing-bucket badge variants: `current | 1-30 | 31-60 | 61-90 | 90+` — must match bucket keys from ageing report API.
- Theme tokens: use `var(--token)` in JSX `className` strings; bare `--token` syntax is CSS/`@theme` only.

## Known ESLint Gotchas

- `react-hooks/set-state-in-effect`: fires on `useEffect(() => setMounted(true), [])` — add `eslint-disable-next-line` for the `next-themes` hydration guard; this is intentional.

## next-themes

- Use `resolvedTheme` (not `theme`) for toggle comparisons to handle `system` default correctly.
- Always wrap theme-dependent render output in a `mounted` guard to prevent hydration mismatch.
