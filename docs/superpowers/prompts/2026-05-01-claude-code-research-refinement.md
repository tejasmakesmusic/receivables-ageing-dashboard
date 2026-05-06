# Claude Code Handoff Prompt: Receivables OS Research And Refinement

You are Claude Code working in the repo root:

`C:\Users\tejas\Projects\receivables`

Your task is **research and refinement only**. Do not implement application code yet. Produce an improved design/spec package and an implementation plan after research. Keep changes small, documented, and reviewable.

## Current Product Direction

We are evolving the existing Receivables Ageing Dashboard into an internal **Receivables OS**: an Order-to-Cash / Accounts Receivable control platform for monthly AR close, collections execution, CFO review, and governance.

Approved design spec:

`docs/superpowers/specs/2026-05-01-receivables-os-design.md`

Visual brainstorming companion artifacts:

`.superpowers/brainstorm/session-20260501-180459/content/`

Especially review:

- `navigation-screen-map.html`: Twenty-inspired light/dark workspace direction
- `operational-objects.html`: operational object model
- `role-workflows-permissions.html`: RBAC and role workflow matrix

## Non-Negotiable Project Guardrails

Read these before doing anything:

1. `AGENTS.md`
2. `02_HANDOFF_SPEC.md` sections 2 and 15
3. `docs/adr/`
4. `README.md`
5. `PROGRESS.md`

Rules:

- Do **not** edit `02_HANDOFF_SPEC.md`.
- Do **not** commit `.env`, OAuth secrets, SMTP keys, DB dumps, or client data.
- Do **not** implement code until the refined spec and implementation plan are approved.
- Use `npm`; do not introduce yarn or pnpm.
- Current runtime stack is Next.js 16 App Router, React 19, TypeScript, Prisma 7, Neon PostgreSQL, Tailwind CSS 4, local shadcn-style primitives, ExcelJS, SheetJS, Fuse.js, Recharts, Vercel.
- Keep Prisma client initialization lazy and build-safe.
- Enforce RBAC in route handlers, not only UI.
- Every mutation must write an `audit_log` row with before/after JSON.
- Parser row errors must remain staged as `PARSE_ERROR`.
- Ageing must use snapshot `as_of_date`, never wall-clock today.
- FX lookup must be pinned by `invoice_date`; FX rows are immutable.
- CFO and PENDING users must never mutate or publish.
- CFO digest email must stay inactive until explicitly activated.

## What To Research

Use online research. Prefer primary/vendor documentation and authoritative finance/accounting references. Capture links in your final output and in any revised spec.

Research tracks:

### 1. AR / O2C Operating Model

Validate terminology and workflows for:

- Order-to-Cash / Invoice-to-Cash
- Accounts receivable subledger
- Aged trial balance
- AR roll-forward
- Dunning
- Promise to Pay
- Dispute management
- Collections worklists
- Credit risk and recoverability review
- CFO working capital review

Seed sources to verify and expand:

- IBM Order-to-Cash: https://www.ibm.com/think/topics/order-to-cash-o2c
- SAP receivables automation: https://www.sap.com/products/financial-management/accounts-receivable-automation.html
- SAP collections/dispute management docs if useful
- Oracle / BlackLine / HighRadius finance ops resources if useful

### 2. Finance Metrics And Accounting Terms

Validate metric naming, formulas, and where the app has enough data to calculate them:

- DSO
- CEI
- AR turnover
- Overdue AR
- 90+ exposure
- Customer concentration
- Ageing migration
- Bad-debt watchlist
- IFRS 9 ECL support / provision matrix evidence

Be conservative: if payment data is missing, do not promise CEI, cash application, or true collections yield.

Seed sources:

- APQC DSO: https://www.apqc.org/resources/benchmarking/open-standards-benchmarking/measures/days-sales-outstanding
- AccountingTools CEI: https://www.accountingtools.com/articles/collection-effectiveness-index
- IFRS 9: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2024/issued/part-a/ifrs-9-financial-instruments.pdf?bypass=on
- IFRS 9 PIR: https://www.ifrs.org/content/dam/ifrs/project/pir-9-impairment/rfi-iasb-2023-1-ifrs9-impairment.pdf
- COSO internal control: https://www.coso.org/guidance-on-ic

### 3. Twenty-Inspired Product Design

Study Twenty as a design-language reference, not a dependency.

Use:

- Repo: https://github.com/twentyhq/twenty
- Twenty UI color scheme docs: https://twenty.com/twenty-ui/section/input/color-scheme
- Experience settings: https://docs.twenty.com/user-guide/settings/capabilities/experience-settings
- `packages/twenty-ui/src/theme-constants/theme-light.css`
- `packages/twenty-ui/src/theme-constants/theme-dark.css`

Borrow ideas only:

- Compact object sidebar
- Table-first object workspaces
- Saved views / filters / sort / group mental model
- Right-side record panel
- Light / Dark / System preference
- Small-radius controls
- Dense operational UI

Do not copy:

- Twenty branding
- Twenty assets
- Screenshots
- Their source files
- Their package as a dependency

### 4. Current Stack Best Practices

Verify current official docs for:

- Next.js 16 App Router, Route Handlers, Server Components, Server Actions, caching, and redirects
- React 19 patterns used by Next
- Prisma 7 with `@prisma/adapter-neon`
- Neon pooled vs direct connection strings
- Vercel environment variables and deployment behavior
- Tailwind CSS 4 `@theme` variables and dark mode tokens
- shadcn/ui dark mode with `next-themes`

Seed sources:

- Next Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
- Next Server/Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Prisma + Neon: https://www.prisma.io/docs/v6/orm/overview/databases/neon
- Neon serverless driver: https://neon.com/docs/serverless/serverless-driver
- Tailwind theme variables: https://tailwindcss.com/docs/theme
- shadcn Next dark mode: https://ui.shadcn.com/docs/dark-mode/next
- Vercel env vars: https://vercel.com/docs/environment-variables

## Refinement Goals

Refine the approved spec into a sharper build-ready product design.

Specifically answer:

1. Which terms should appear in navigation, page headings, table columns, and tooltips?
2. Which proposed metrics are supported by current data, and which must remain hidden or explicitly marked as future?
3. Which operational objects require new database tables, and which can initially be derived or layered over existing records?
4. How should Collection Tasks, Promise To Pay, Dispute Cases, Follow-ups, and Audit Log relate?
5. What should the first implementation slice be so the product becomes useful quickly without destabilizing the current app?
6. What is the exact light/dark design token plan for Tailwind CSS 4 and local shadcn-style components?
7. What route-level RBAC checks and tests are required before CFO users can be invited?
8. What should stay out of scope to preserve accounting integrity?

## Expected Outputs

Create or update markdown files only unless Tejaswa explicitly approves implementation.

Recommended output files:

1. `docs/superpowers/research/2026-05-01-receivables-os-research.md`
   - Research findings
   - Source links
   - Recommended terminology
   - Supported vs unsupported metrics
   - Product risks

2. `docs/superpowers/specs/2026-05-01-receivables-os-design.md`
   - Refine the existing spec in place if the research improves it.
   - Keep the locked handoff spec untouched.
   - Record what changed and why.

3. `docs/superpowers/plans/2026-05-01-receivables-os-implementation-plan.md`
   - Sequenced implementation plan
   - File-level change map
   - Data model changes
   - API / server action plan
   - UI page plan
   - Test plan
   - Verification commands

If the research changes product scope materially, stop after the research doc and ask Tejaswa for approval before writing an implementation plan.

## Implementation Planning Constraints

When writing the plan, assume the implementation will follow these phases unless research suggests a better order:

1. Theme and shell refinement
2. Operational object schema
3. Collection Task lifecycle
4. Promise To Pay and Dispute Case workflows
5. CFO Review
6. Admin governance and digest controls
7. Tests and production hardening

The plan must include:

- Prisma schema changes and migration strategy
- Lazy Prisma client considerations for Vercel builds
- Route handlers / server actions and RBAC requirements
- Audit log writes for every mutation
- UI components and pages to touch
- Light/dark mode test plan
- Entity-scope tests
- CFO/PENDING mutation-block tests
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## Review Standard

Before claiming done:

- Run a placeholder scan for `TBD`, `TODO`, `??`, and vague "later" phrasing.
- Check all recommendations against `02_HANDOFF_SPEC.md` guardrails.
- Confirm no code implementation was performed.
- Confirm no secrets or `.env` were touched.
- Summarize sources used.
- Summarize files changed.
- Ask Tejaswa to approve the refined spec before implementation begins.

## Current Git Caveat

The repository may already have a large dirty worktree from the FastAPI/Vite-to-Next refactor. Do not revert unrelated files. Work only on the research/spec/plan files unless explicitly approved.

There is currently a staged design spec file in this session:

`docs/superpowers/specs/2026-05-01-receivables-os-design.md`

If Git author identity is missing, do not invent it. Leave changes staged or unstaged and report the exact state.

## Tone

Write like a senior product engineer with finance/accounting care:

- Precise
- Conservative with accounting claims
- Clear about supported vs future metrics
- Practical about build order
- No marketing fluff
- No generic SaaS dashboard language when AR/O2C terminology is clearer
