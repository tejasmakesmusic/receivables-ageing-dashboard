# Receivables OS Product UI Productization Design

- Date: 2026-05-06
- Status: Direction approved by Tejaswa on 2026-05-06. Pending review of this written spec before implementation planning.
- Product direction: Hybrid Command Center, warm light theme, Twenty-style object workspace, Duolingo-inspired operating loops without finance-inappropriate gamification.

## Approved Direction

This iteration upgrades the application from a functional but bare-bones AR dashboard into a working finance operations product. The target is not a marketing site and not a generic CRM clone. It is a dense, fast, calm receivables workspace where analysts can start the day, work the highest-risk items, inspect account/invoice context, reconcile exceptions, and administer controls without losing orientation.

Approved visual and workflow decisions:

- Use a persistent sidebar and global top bar across the app.
- Use a warm, light-only theme with blue as the primary action accent.
- Remove dark-theme switching from the launch UI.
- Make major objects feel first-class: accounts, invoices, collections tasks, promises, disputes, snapshots, reconciliations, workflows, reports, and admin settings.
- Prefer saved views, dense tables, right-side preview drawers, kanban/workflow boards, KPI strips, and quick actions over isolated static pages.
- Add animations only where they clarify state, progress, or focus.
- Add loading, empty, filtered-empty, blocked, and no-permission states.

## Inputs

Functional and architecture sources:

- `02_HANDOFF_SPEC.md` section 2 and section 15.
- ADRs in `docs/adr/`.
- `README.md` and `PROGRESS.md`.
- `C:/Users/tejas/Downloads/Receivables_OS_PRD_Twenty_Duolingo_UX_Guidelines.pdf`, especially section 9.

External product references inspected for patterns, not copied:

- https://github.com/twentyhq/twenty
- https://docs.twenty.com/getting-started/core-concepts/layout

User-provided visual references:

- Home / Today's Focus command center.
- Core Workflows process page.
- CFO Dashboard.
- Admin & Configuration with permissions drawer.
- Accounts list with account preview drawer.
- Account detail with action header and right rail.
- Invoice Ageing Workbench with invoice drawer.
- Collections board.
- Reconciliation Center.
- Workflow Builder.

## Non-Negotiable Guardrails

This UI pass does not change the locked finance rules. It must preserve these invariants:

- Ageing uses snapshot `as_of_date`, never wall-clock today.
- Due date is computed from invoice date plus approved credit days.
- Do not use Tally or Xero overdue/due fields as ageing authority.
- Do not invent credit period defaults.
- Do not auto-backfill history.
- Do not mutate FX rows after creation.
- Do not persist the UAE credit-period `Amount` column.
- Do not silently hide parser errors.
- CFO and PENDING users cannot mutate operational records.
- Every mutation route keeps RBAC and audit-log behavior.
- CFO email and reminder sending remain inactive unless explicitly activated by Tejaswa.
- No fake cash-collection feed is invented. Surfaces that imply cash received must be backed by current data or reframed as promise/dispute/reconciliation state.

## Product Architecture

The redesign is a presentation and workflow layer over the existing Next.js, React, Prisma, Neon, Tailwind, and Recharts app. Existing services remain the source of truth. New UI-specific read models may be added when a screen needs a composed view, but they must not duplicate domain rules in client components.

The product shell owns:

- Sidebar navigation.
- Global search input shell.
- Entity selector.
- Snapshot/date selector.
- Notifications affordance.
- User menu.
- Responsive content frame.

Feature pages own:

- Page heading and primary actions.
- Saved views or tabs.
- Filters.
- Main operating surface.
- Right rail or detail drawer.
- Empty/loading/error states.

Server services own:

- Role-scoped data queries.
- Derived metrics.
- Snapshot-as-of calculations.
- Risk and priority facts.
- Mutation eligibility.

Client components own:

- Selection state.
- Local filters that do not alter server authorization.
- Drawers, tabs, menus, hover/focus states, and lightweight animations.

## Visual System

### Theme

The launch theme is light-only. The UI should feel close to the screenshots: mostly white, slightly warm shell surfaces, thin borders, blue primary actions, semantic status colors, and very restrained shadows.

Core tokens:

| Token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#ffffff` | Main work area |
| `--color-bg-subtle` | `#fcfbf9` | Sidebar, top bar, grouped panels |
| `--color-bg-muted` | `#f5f2ee` | Hover, filter bars, grouped table sections |
| `--color-surface` | `#ffffff` | Cards, tables, panels |
| `--color-border` | `#ebe7df` | Default separators |
| `--color-border-strong` | `#d8d2c8` | Focused inputs, selected rows, drawer edge |
| `--color-text` | `#111827` | Primary text and values |
| `--color-text-muted` | `#5f6b7a` | Metadata and secondary labels |
| `--color-text-subtle` | `#8a95a3` | Empty states and placeholders |
| `--color-accent` | `#2563eb` | Primary actions, active nav, links |
| `--color-accent-soft` | `#eaf1ff` | Active nav and selected rows |
| `--color-success` | `#16a34a` | Positive operational state |
| `--color-warning` | `#f59e0b` | Attention/watch state |
| `--color-danger` | `#ef4444` | Risk/blocker state |
| `--color-violet` | `#7c3aed` | Workflow/dispute accents, sparingly |

The palette must not become beige-heavy. White and neutral table surfaces should dominate; warm tint is used mainly in shell surfaces and subtle grouping.

### Typography

- Use the repo's existing font stack unless a later implementation plan confirms an Inter/Geist change is already configured.
- Page titles: 24px, 600 weight.
- Section titles: 15-18px, 600 weight.
- Body and controls: 13-14px.
- Table cells: 12-13px desktop, 14px mobile/tablet.
- Labels and metadata: 11-12px, 500 weight where useful.
- Letter spacing remains `0`.

### Geometry

- Cards and panels use 8px radius or less.
- Table controls and small inputs use 6px radius or less.
- Status tags may be pill-shaped.
- Borders do most of the work; shadows only for floating menus, right drawers, and transient overlays.
- Tables target 36-44px rows on desktop.
- Right drawers target 380-460px on desktop and full-screen on mobile.

### Motion

- Transitions should be short and functional: 120-160ms for hover, drawer, tab, and selection changes.
- Respect `prefers-reduced-motion`.
- Use skeleton loading instead of spinners for tables and cards.
- Use progress-ring or progress-path animation only for task completion, upload/staging progress, reconciliation progress, and daily goal updates.
- No decorative bouncing, confetti, or childish reward mechanics.

## Navigation Model

The sidebar should use clear product labels aligned with the screenshots:

| Nav label | Target route | Notes |
| --- | --- | --- |
| Home | `/` | Today's Focus command center |
| Accounts | `/accounts` | Canonical parties/account list; links to `/party/[canonicalId]` |
| Invoices | `/invoices` | Invoice Ageing Workbench |
| Collections | `/collections` | Board, queue, and calendar tabs |
| Reconciliation | `/reconciliation` | New top-level center; can reuse existing admin reconciliation logic internally |
| Workflows | `/workflows` | Core workflow overview first; builder can be gated |
| Reports | `/reports` | CFO dashboard and exports |
| Dashboards | `/dashboard` | Existing dashboard entry, consolidated views later |
| Admin | `/admin` | Settings workspace |

Existing routes remain available. If a route moves visually, add a redirect or link rather than deleting established paths during this pass.

Role visibility:

- Analysts see entity-scoped operational surfaces.
- CFO sees read-only Home, Accounts, Invoices, Collections, Reconciliation, Reports, and Dashboards.
- Admin sees all operational surfaces plus configuration controls.
- Pending sees only the access-pending page.

## Component System

Build shared components before rebuilding pages:

- `WorkspaceShell`: sidebar, top bar, content frame.
- `SidebarNav`: icon + label rows, active state, collapsed-ready but not required to ship collapsed.
- `GlobalTopbar`: search, entity selector, date/snapshot selector, notification button, profile menu.
- `PageHeader`: title, subtitle, primary actions, view customizer.
- `MetricCard`: compact KPI, trend, sparkline slot, semantic delta.
- `SavedViewTabs`: horizontal tabs with count badges and add-view affordance.
- `FilterBar`: search, selects, date filters, more filters button.
- `DataTable`: dense headers, selected rows, bulk action bar, empty/loading/error states.
- `StatusTag`: reuse and extend the existing semantic tag foundation.
- `RightDrawer`: record preview, action rail, tabbed sections, close/open-full affordance.
- `QuickActions`: compact command buttons with icons.
- `Timeline`: activity, audit, reminder, promise, dispute, and reconciliation events.
- `ProgressRing`, `ProgressPath`, `NudgeCard`, and `GoalPanel`: engagement primitives for controllable work only.
- `EmptyState`: title, short reason, next action, optional secondary link.
- `SkeletonBlock`: table, card, right drawer, and dashboard variants.

Use lucide icons for navigation and actions unless the existing app already provides an equivalent icon set. Buttons should use icons where the action is familiar.

## Screen Specifications

### Home: Today's Focus

Purpose: Make the first screen feel like the analyst's operating desk, not a static dashboard.

Layout:

- KPI strip across the top: total outstanding, overdue, due this week, promises to pay, collection efficiency or task completion.
- Main panel: Prioritized Focus Queue table with account, invoice, bucket, amount, last action, next best action, owner, status.
- Right rail: Daily Goal, reminders and nudges, quick actions, recent activity.
- Lower band: Ageing Summary, Cash/Promise Forecast, Top Overdue Accounts.

Behavior:

- Row click opens the appropriate invoice/account/task drawer.
- Quick actions open contextual forms or route to existing pages.
- Daily goal tracks controllable actions such as follow-ups logged, promises reviewed, staging warnings resolved, or reconciliations reviewed.
- If no data exists, show a launch-ready empty state with upload/start actions rather than blank cards.

### Accounts

Purpose: Turn canonical parties into a true account workspace.

Layout:

- KPI strip: total accounts, high-risk accounts, strategic/watch accounts, blocked accounts.
- Saved views: All Accounts, High Risk, Strategic, India, UAE, custom add view.
- Filter bar: account search, segment, entity, collection health, country, owner, more filters, sort.
- Dense table: account, segment, entity, total outstanding, overdue, credit config status, DSO/age proxy when supported, health, owner, next action.
- Right drawer: selected account summary, primary contact, open invoices, recent activity, quick action/full account link.

Behavior:

- `/accounts` can be a new route backed by canonical party data.
- `/party/[canonicalId]` becomes the full account detail page and should match the account-detail screenshot pattern.
- Do not invent credit limits or payment health data if not in the existing model; show empty/unsupported states or derive only from available invoice/task data.

### Account Detail

Purpose: Give the analyst full context before contacting a customer.

Layout:

- Header: back link, account name, id/entity, risk/status tags, primary actions.
- Tabs: Overview, Invoices, Contacts, Activity, Documents, Workflows. Tabs without backend support can render honest empty states.
- Overview: exposure KPI strip, open invoices table, activity timeline, key contacts, promises to pay, disputes.
- Right rail: account health score only if explainable, next best action, recent reminders, quick actions.

Behavior:

- Financial numbers link back to source invoices/snapshots.
- Health score must show drivers, or be deferred.
- Mutating actions remain hidden/disabled for CFO and PENDING users.

### Invoice Ageing Workbench

Purpose: Make `/invoices` the primary operational table for ageing, filters, and bulk work.

Layout:

- Bucket KPI cards: Current/Not Due, 0-30, 31-60, 61-90, 90+, total outstanding.
- Ageing distribution bar.
- Filter grid: entity, bucket, owner, customer, due date, promise status, dispute status, more filters.
- Bulk action bar when rows are selected.
- Dense invoices table: invoice, account, issue date, due date, age, bucket, amount, outstanding, last reminder, promise date, risk, suggested action, owner, status.
- Right drawer: invoice detail, recent activity, reconciliation notes, and links to invoice/account detail. Payment portal links are hidden in this pass because no customer payment portal exists yet.

Behavior:

- Ageing bucket values come from existing snapshot-as-of logic.
- "Payment portal" and cash-receipt actions are hidden until product support exists.
- Selected bulk actions must respect role and state-machine eligibility.

### Collections

Purpose: Make collections feel like an operating board, not a read-only list.

Layout:

- Header with campaign/saved view selector, settings, run batch reminder affordance gated behind approved email rules.
- Tabs: Board, Calendar, Queue.
- Board columns: New, Reminder Sent, Promise to Pay, Escalated, Payment Expected, Closed.
- Cards show account, invoice, amount, due/promise date, risk, owner, next action.
- Right rail: collection progress, upcoming calls, promises due today, queue overview.

Behavior:

- If drag-and-drop is implemented, it must call the same state-machine-safe routes as table actions.
- Reminder/email actions stay disabled or preview-only unless approved rules and delivery configuration are active.
- Empty columns show "Add card" or "View queue" actions, not blank space.

### Reconciliation Center

Purpose: Promote reconciliation from an admin table into a finance workflow center.

Layout:

- Stepper: Import Files, Map Columns, Match Transactions, Review Exceptions, Finalize.
- Source cards: Tally/Xero/ledger/payment sources only where supported by current ingestion.
- Match metrics: matched, mismatched, unmatched, exceptions, auto-matched where data exists.
- Exception tabs and table.
- Right drawer: selected transaction/snapshot/reconciliation detail, suggested fixes, lineage.

Behavior:

- The first implementation can wrap the existing snapshot reconciliation model instead of inventing bank/payment matching.
- Unsupported transaction matching surfaces must be clearly empty/future, not fake.
- Admin and Analyst mutations stay audited.

### Core Workflows

Purpose: Explain and operate the end-to-end AR workflow.

Layout:

- Three horizontal lifecycle bands: Daily Analyst Flow, Collections Lifecycle, Reconciliation & Close.
- Each band has numbered cards, status chips, and handoff labels.
- Right rail: platform functions and week-at-a-glance metrics.

Behavior:

- Cards deep-link to the real route/action they represent.
- Metrics are sourced from existing services or shown as unavailable.
- This page can ship before a fully editable workflow builder.

### Workflow Builder

Purpose: Provide the product direction for future no-code automation without overbuilding before launch.

Launch approach:

- Ship as a read-only or limited draft surface unless the backend workflow contract is approved.
- Show triggers/actions that map to existing safe operations: invoice overdue, promise broken, risk increased, dispute opened, send reminder preview, create task, escalate, delay, update field, and send notification preview. Payment-received triggers are deferred until a receipt source exists.
- Publish/Test buttons must be disabled or routed to an explicit not-yet-configured state until the execution engine exists.

### Reports / CFO Dashboard

Purpose: Give CFO users a fast executive view while preserving read-only rules.

Layout:

- Filters: entity, quarter/date range, segment, currency.
- KPI cards: total AR, overdue percentage, DSO only if caveated, collections vs target only if target exists.
- Charts: DSO trend, collections/promises vs target, expected cash/promises, ageing waterfall.
- Tables: top risk accounts, analyst productivity only if role-scoped and approved.
- Right rail: executive insights and quick actions.

Behavior:

- Do not show uncaveated DSO if payment-side data is incomplete.
- CFO quick actions are drilldowns/exports, not mutations.
- Insights must be explainable from source metrics.

### Admin & Configuration

Purpose: Make admin feel like a proper settings workspace.

Layout:

- Admin subnav: Users & Roles, Entities, Credit Policies, Ageing Rules, Reminder Templates, Workflow Permissions, Integrations, Audit Logs.
- Main content: users table, notification templates, approval rules.
- Right drawer: selected role/user permissions with toggles, tabs, cancel/save.

Behavior:

- Existing admin routes remain the data authority.
- Toggles that do not have a backend mutation yet render disabled with clear copy.
- Any save goes through audited route handlers.

## Empty, Loading, And Error States

Every major page must include:

- Loading skeleton for first render and drawer content.
- Empty state for no records.
- Filtered-empty state for filters that return no results.
- Error state with retry or route back.
- No-permission state that does not leak AR data.
- Stale/no-snapshot state that points analysts to upload or staging.

Example empty states:

- No invoices in this view: "No invoices match these filters." Action: "Clear filters".
- No broken promises due today: "No broken promises due today." Action: "View open promises".
- No published snapshot: "Publish a snapshot to calculate ageing." Action: "Upload workbook".
- CFO no access to action: "This action is analyst/admin only." Action: "Open read-only detail".

## Engagement UX Guardrails

Borrow from Duolingo only where it helps finance users finish controllable work:

- Daily goal: completed follow-ups, reviewed promises, resolved staging warnings, submitted reconciliations.
- Streak: on-time follow-up discipline with holiday/leave/system freeze support later.
- Nudges: promise due, stale follow-up, digest awaiting approval, reconciliation mismatch.
- Progress path: upload, parse, review, resolve, publish, reconcile.

Never reward:

- Cash collected.
- Pressuring customers.
- Closing invoices without evidence.
- Hiding disputes.
- Using overrides.

Copy should be calm and factual. No guilt, no childish tone, no confetti for financial risk events.

## Performance And Loading Strategy

- Prefer server-rendered pages with small client islands for drawers, filters, tabs, and selections.
- Lazy-load heavier charts and workflow canvases.
- Keep chart libraries centralized; do not add another charting dependency without need.
- Avoid fetching data from client components when a server service can prepare the view.
- Use table pagination and scoped queries for account/invoice/work queues.
- Avoid shipping hidden full-page data into the client for drawers; fetch drawer payloads by id when needed if data is large.
- Use CSS transitions, not heavy animation libraries, for this pass.

## Accessibility And Keyboard

- `/` focuses global search when implemented.
- `Ctrl+K` / `Cmd+K` opens the command menu once search contract is approved.
- `Esc` closes drawers/menus.
- `Enter` opens selected row where row keyboard navigation exists.
- Every icon button has an accessible label and tooltip.
- Status tags expose text labels and do not rely on color alone.
- Focus rings are visible against white and warm shell surfaces.
- Reduced motion disables nonessential animation.

## Testing And Verification

Required verification before claiming implementation complete:

- `npm run typecheck`
- `npm run lint`
- `npm test` when tests are added or touched
- `npm run build`

Additional UI verification:

- Browser check on the in-app browser at desktop width.
- Browser check at a narrower/tablet viewport for shell, tables, and drawers.
- Screenshot comparison against the user-provided direction for Home, Accounts, Invoices, Collections, Reconciliation, Workflows, and Admin.
- Empty-state walkthrough using a no-data or filtered-empty condition.
- Role-aware visual check for CFO/PENDING mutation restrictions on each redesigned route.

Test focus:

- View-model tests for any new composed metric/read model.
- Status tag regression tests for new semantic states.
- RBAC tests remain route-level, not merely UI visibility.
- Component tests are optional unless existing test infrastructure already supports them cleanly.

## Implementation Milestones

### Milestone 1: Shell And Design System

- Replace the current bare shell with the warm light workspace shell.
- Remove or hide dark-mode switching.
- Add shared product UI primitives listed above.
- Add loading/empty/error components.
- Keep existing routes working.

### Milestone 2: Home And Daily Focus

- Rebuild `/` as Today's Focus.
- Reuse existing Focus Queue and dashboard services.
- Add daily goal, nudges, quick actions, recent activity, and lower insight cards.

### Milestone 3: Accounts And Invoices

- Add `/accounts` list and redesign `/party/[canonicalId]`.
- Redesign `/invoices` as Invoice Ageing Workbench.
- Add account and invoice right drawers or drawer-like panels.

### Milestone 4: Collections And Reconciliation

- Rework `/collections` into Board/Calendar/Queue tabs.
- Promote reconciliation into `/reconciliation`.
- Preserve existing admin reconciliation route or redirect it into the new center.

### Milestone 5: Workflows, Reports, Admin Polish

- Add Core Workflows page.
- Add limited Workflow Builder direction if no backend engine exists.
- Add Reports/CFO dashboard shell.
- Upgrade Admin & Configuration layout and permissions drawer.

## Out Of Scope For This UI Pass

- Customer portal.
- Payment gateway.
- Bank/payment transaction matching unless already present in backend data.
- New workflow execution engine.
- Predictive AI risk scoring.
- Real reminder delivery activation.
- Broad schema redesign.
- Storybook setup unless the implementation plan chooses it as a focused follow-up.

## Review Checklist

- No dark theme in launch UI.
- No fake financial data sources.
- No domain-rule change hidden inside visual work.
- Every screen has loading and empty states.
- Every mutation remains route-authorized and audited.
- CFO and PENDING remain non-mutating.
- Tables stay dense and operational.
- Right drawers preserve user context.
- The product feels closer to the provided screenshots than the current bare-bones app.

End of design.
