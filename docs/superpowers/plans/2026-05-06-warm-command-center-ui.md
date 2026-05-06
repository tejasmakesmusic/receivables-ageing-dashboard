# Warm Command Center UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable Receivables OS productization slice: a warm light-only shell, reusable workspace UI primitives, Today's Focus home, Accounts, Invoice Ageing Workbench, Collections board, and light-weight Reconciliation / Workflows / Reports / Admin upgrades.

**Architecture:** Keep domain logic in server services and compose UI read models on the server. Client components are used only for local interaction state such as selected drawers, tabs, filters, and simple progress animation. This plan does not add schema changes or new finance rules.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Prisma 7, Recharts, lucide-react, Vitest.

---

## Scope

This plan implements the first UI productization slice from `docs/superpowers/specs/2026-05-06-product-ui-productization-design.md`.

In scope:

- Light-only warm theme.
- Persistent sidebar and top bar.
- Shared workspace components.
- Today's Focus home route.
- Accounts list route backed by canonical parties.
- Refreshed party detail.
- Invoice Ageing Workbench.
- Collections board/read-only calendar/queue tabs.
- Reconciliation, Workflows, Reports, and Admin surfaces upgraded enough to match the shell and avoid bare-bones pages.
- Loading, empty, filtered-empty, and no-permission states where pages expose a state boundary.

Out of scope:

- Customer payment portal.
- Payment gateway.
- Bank/payment transaction matching.
- Workflow execution engine.
- Predictive AI risk scoring.
- Real reminder delivery activation.
- New database tables.

## File Structure

Create:

- `src/components/ui/workspace.tsx` - product shell primitives: page header, metric card, empty state, saved tabs, filter shell, right rail, progress ring.
- `src/components/ui/data-table.tsx` - table shell and reusable table empty row helpers.
- `src/components/ui/mini-chart.tsx` - CSS-only sparkline/progress helpers for fast KPI cards.
- `src/server/home/service.ts` - Today's Focus server read model.
- `src/server/__tests__/home-service.test.ts` - tests for home read-model helpers and role-safe composition.
- `src/server/accounts/service.ts` - account list server read model backed by canonical parties/invoices.
- `src/server/__tests__/accounts-service.test.ts` - tests for account aggregation helpers.
- `src/server/invoices/workbench.ts` - invoice workbench bucket/filter aggregation helpers.
- `src/server/__tests__/invoice-workbench.test.ts` - tests for bucket summaries and filtered-empty behavior.
- `src/server/collection-tasks/board.ts` - collection board grouping helpers.
- `src/server/__tests__/collection-board.test.ts` - tests for board grouping.
- `src/app/accounts/page.tsx` - Accounts workspace.
- `src/app/reconciliation/page.tsx` - top-level Reconciliation Center.
- `src/app/workflows/page.tsx` - Core Workflows page.
- `src/app/reports/page.tsx` - CFO/Reports shell.

Modify:

- `src/app/globals.css` - warm light tokens, remove dark token override.
- `src/app/layout.tsx` - remove `ThemeProvider` and force light shell.
- `src/components/shell/app-shell.tsx` - integrate top bar and content frame.
- `src/components/shell/Sidebar.tsx` - icon nav, warm shell, no mode toggle.
- `src/components/shell/topbar.tsx` - global search/entity/date/profile controls.
- `src/components/ui/button.tsx` - token-based button variants.
- `src/components/ui/card.tsx` - token-based 8px cards/panels.
- `src/components/ui/badge.tsx` - remove dark classes and align semantic tags.
- `src/components/ui/status-tag-map.ts` - add missing workflow/empty/read-only states.
- `src/app/page.tsx` - replace migration smoke UI with Today's Focus.
- `src/app/invoices/page.tsx` - replace static register with Invoice Ageing Workbench.
- `src/app/party/[canonicalId]/page.tsx` - upgrade Account Detail layout.
- `src/app/collections/page.tsx` - add board/calendar/queue tabs and right rail.
- `src/app/admin/page.tsx` - settings workspace layout.
- `src/app/admin/reconciliation/page.tsx` - link or visually align with top-level Reconciliation Center.
- `PROGRESS.md` - note UI productization slice once verified.

## Task 1: Light Theme And Shell Foundation

**Files:**

- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/shell/app-shell.tsx`
- Modify: `src/components/shell/Sidebar.tsx`
- Modify: `src/components/shell/topbar.tsx`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/badge.tsx`

- [ ] **Step 1: Remove dark provider from layout**

Replace `src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receivables OS",
  description: "AR control platform - EMB Global",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Replace theme tokens**

In `src/app/globals.css`, remove `@custom-variant dark` and the `:root.dark` block. Use these token values inside `@theme`:

```css
@theme {
  --font-sans:
    Inter, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial,
    "Apple Color Emoji", "Segoe UI Emoji", sans-serif;

  --color-bg: #ffffff;
  --color-bg-subtle: #fcfbf9;
  --color-bg-muted: #f5f2ee;
  --color-surface: #ffffff;

  --color-border: #ebe7df;
  --color-border-strong: #d8d2c8;

  --color-text: #111827;
  --color-text-muted: #5f6b7a;
  --color-text-subtle: #8a95a3;

  --color-accent: #2563eb;
  --color-accent-soft: #eaf1ff;
  --color-accent-strong: #1d4ed8;

  --color-success-soft: #eaf8ef;
  --color-warning-soft: #fff7df;
  --color-danger-soft: #fff0f0;
  --color-violet-soft: #f3edff;

  --color-status-neutral-bg: #f7f5f2;
  --color-status-neutral-border: #e7e2da;
  --color-status-neutral-text: #5f6b7a;
  --color-status-info-bg: #eaf1ff;
  --color-status-info-border: #c8dcff;
  --color-status-info-text: #1d4ed8;
  --color-status-current-bg: #eaf8ef;
  --color-status-current-border: #bde9cb;
  --color-status-current-text: #16743a;
  --color-status-warning-bg: #fff7df;
  --color-status-warning-border: #f4df91;
  --color-status-warning-text: #8a6200;
  --color-status-alert-bg: #fff2e4;
  --color-status-alert-border: #ffd3a6;
  --color-status-alert-text: #a64b00;
  --color-status-danger-bg: #fff0f0;
  --color-status-danger-border: #ffc7c7;
  --color-status-danger-text: #b42318;

  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-pill: 9999px;

  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;
  --spacing-8: 32px;
}
```

- [ ] **Step 3: Update reusable primitive styling**

Update `Button`, `Card`, and `Badge` classes to use token colors. Button variants must map to:

```ts
const variantClasses: Record<ButtonVariant, string> = {
  default:
    "border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)]",
  secondary:
    "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
  destructive:
    "border border-red-500 bg-red-500 text-white hover:bg-red-600",
};
```

Use focus classes:

```ts
"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
```

- [ ] **Step 4: Replace app shell**

`AppShell` should render sidebar, top bar, and a full-height content area:

```tsx
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/topbar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-subtle)] text-[var(--color-text)]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)]">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace sidebar nav**

Use lucide icons and these nav labels:

```ts
const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/accounts", label: "Accounts", icon: Building2 },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/collections", label: "Collections", icon: Inbox },
  { href: "/reconciliation", label: "Reconciliation", icon: RefreshCw },
  { href: "/workflows", label: "Workflows", icon: SlidersHorizontal },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/dashboard", label: "Dashboards", icon: PieChart },
  { href: "/admin", label: "Admin", icon: Settings },
] as const;
```

Remove `ModeToggle` from the sidebar footer. Footer should show Acme Corp/EMB Global workspace copy with no dark switch.

- [ ] **Step 6: Replace top bar**

`Topbar` should render search, entity/date controls, notification, and user affordance as non-mutating controls:

```tsx
export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex h-10 w-full max-w-[520px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm text-[var(--color-text-muted)]">
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="truncate">Search accounts, invoices, contacts...</span>
          <kbd className="ml-auto rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-subtle)]">
            Ctrl K
          </kbd>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)]">
          All Entities
        </button>
        <button className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)]">
          Latest Snapshot
        </button>
        <button aria-label="Notifications" className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
          <Bell className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent)] text-xs font-semibold text-white">
            AC
          </div>
          <div className="hidden text-sm md:block">
            <div className="font-medium text-[var(--color-text)]">Jane Cooper</div>
            <div className="text-xs text-[var(--color-text-muted)]">Analyst</div>
          </div>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 7: Verify shell**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

## Task 2: Shared Workspace Components

**Files:**

- Create: `src/components/ui/workspace.tsx`
- Create: `src/components/ui/data-table.tsx`
- Create: `src/components/ui/mini-chart.tsx`
- Modify: `src/components/ui/status-tag-map.ts`
- Test: `src/server/__tests__/ui-status-map.test.ts`

- [ ] **Step 1: Extend status map test first**

Add these states to `REQUIRED_FINANCE_STATES` in `src/server/__tests__/ui-status-map.test.ts`:

```ts
"READ_ONLY",
"NO_DATA",
"FOLLOW_UP_DUE",
"STAGING_BLOCKED",
"TASK_SNOOZED",
"TASK_DONE",
"RECONCILIATION_PENDING",
"WORKFLOW_DRAFT",
"WORKFLOW_DISABLED",
```

- [ ] **Step 2: Run the status test and confirm failure**

Run:

```bash
npm test -- src/server/__tests__/ui-status-map.test.ts
```

Expected: fails because the new state keys are missing.

- [ ] **Step 3: Add status definitions**

Add the missing keys to `STATUS_TAGS`:

```ts
READ_ONLY: tag("Read-only", "neutral"),
NO_DATA: tag("No Data", "neutral"),
FOLLOW_UP_DUE: tag("Follow-up Due", "warning"),
STAGING_BLOCKED: tag("Staging Blocked", "danger"),
RECONCILIATION_PENDING: tag("Reconciliation Pending", "warning"),
WORKFLOW_DRAFT: tag("Draft", "info"),
WORKFLOW_DISABLED: tag("Not Configured", "neutral"),
```

- [ ] **Step 4: Create workspace primitives**

Create `src/components/ui/workspace.tsx` with exported components:

```tsx
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

export function PageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1680px] flex-col gap-5 p-6", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  actions,
  children,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  eyebrow?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs text-[var(--color-text-muted)]">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{title}</h1>
        {children ? <div className="mt-1 text-sm text-[var(--color-text-muted)]">{children}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]", className)}>
      {children}
    </section>
  );
}

export function MetricCard({
  accent,
  label,
  meta,
  value,
}: {
  accent?: ReactNode;
  label: string;
  meta?: ReactNode;
  value: ReactNode;
}) {
  return (
    <Panel className="min-h-[118px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold text-[var(--color-text)]">{label}</div>
        {accent}
      </div>
      <div className="mt-5 text-2xl font-semibold text-[var(--color-text)]">{value}</div>
      {meta ? <div className="mt-3 text-xs text-[var(--color-text-muted)]">{meta}</div> : null}
    </Panel>
  );
}

export function EmptyState({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] p-8 text-center">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-[var(--color-text-muted)]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SavedViewTabs({ children }: { children: ReactNode }) {
  return (
    <nav className="flex min-h-10 flex-wrap items-center gap-2 border-b border-[var(--color-border)]">
      {children}
    </nav>
  );
}

export function RightRail({ children }: { children: ReactNode }) {
  return <aside className="flex w-full flex-col gap-4 xl:w-[360px]">{children}</aside>;
}
```

- [ ] **Step 5: Create table shell**

Create `src/components/ui/data-table.tsx`:

```tsx
import type { ReactNode } from "react";

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function EmptyTableRow({
  children,
  colSpan,
}: {
  children: ReactNode;
  colSpan: number;
}) {
  return (
    <tr>
      <td className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}
```

- [ ] **Step 6: Create mini chart helpers**

Create `src/components/ui/mini-chart.tsx`:

```tsx
export function MiniSparkline({
  color = "var(--color-accent)",
}: {
  color?: string;
}) {
  return (
    <svg aria-hidden="true" className="h-9 w-24" viewBox="0 0 96 36">
      <path
        d="M2 30 C14 26 14 17 26 19 C39 22 37 8 50 11 C61 14 60 6 72 8 C82 10 83 5 94 6"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}

export function ProgressBar({
  value,
}: {
  value: number;
}) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
      <div
        className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150"
        style={{ width: `${bounded}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 7: Verify shared components**

Run:

```bash
npm test -- src/server/__tests__/ui-status-map.test.ts
npm run typecheck
```

Expected: both pass.

## Task 3: Today's Focus Server Read Model

**Files:**

- Create: `src/server/home/service.ts`
- Create: `src/server/__tests__/home-service.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/server/__tests__/home-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDailyGoal, buildHomeNudges } from "@/server/home/service";

describe("home command center helpers", () => {
  it("bounds daily goal percent and remaining count", () => {
    expect(buildDailyGoal({ completed: 4, target: 10 })).toEqual({
      completed: 4,
      target: 10,
      remaining: 6,
      percent: 40,
    });
    expect(buildDailyGoal({ completed: 12, target: 10 })).toEqual({
      completed: 12,
      target: 10,
      remaining: 0,
      percent: 100,
    });
  });

  it("builds actionable nudges from focus counts", () => {
    const nudges = buildHomeNudges({
      brokenPromises: 2,
      highRiskItems: 3,
      reconciliationItems: 1,
    });

    expect(nudges.map((nudge) => nudge.title)).toEqual([
      "3 high-risk accounts need attention",
      "2 promises to pay need review",
      "1 reconciliation item needs review",
    ]);
  });
});
```

- [ ] **Step 2: Run helper tests and confirm failure**

Run:

```bash
npm test -- src/server/__tests__/home-service.test.ts
```

Expected: fails because `src/server/home/service.ts` does not exist.

- [ ] **Step 3: Implement home service helpers and read model**

Create `src/server/home/service.ts`:

```ts
import "server-only";
import { getPrisma } from "@/lib/prisma";
import type { DashboardResponse } from "@/server/dashboard/types";
import { getDashboard } from "@/server/dashboard/service";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { getFocusQueue, type FocusQueueItem } from "@/server/focus/service";
import { role_enum } from "@/generated/prisma/enums";

export interface DailyGoal {
  completed: number;
  target: number;
  remaining: number;
  percent: number;
}

export interface HomeNudge {
  tone: "warning" | "info" | "success";
  title: string;
  description: string;
  href: string;
}

export interface HomeCommandCenter {
  dashboard: DashboardResponse | null;
  dashboard_error: string | null;
  focus_items: FocusQueueItem[];
  focus_total: number;
  daily_goal: DailyGoal;
  nudges: HomeNudge[];
  is_read_only: boolean;
}

export function buildDailyGoal({
  completed,
  target,
}: {
  completed: number;
  target: number;
}): DailyGoal {
  const safeTarget = Math.max(1, target);
  const safeCompleted = Math.max(0, completed);
  return {
    completed: safeCompleted,
    target: safeTarget,
    remaining: Math.max(0, safeTarget - safeCompleted),
    percent: Math.min(100, Math.round((safeCompleted / safeTarget) * 100)),
  };
}

export function buildHomeNudges({
  brokenPromises,
  highRiskItems,
  reconciliationItems,
}: {
  brokenPromises: number;
  highRiskItems: number;
  reconciliationItems: number;
}): HomeNudge[] {
  const nudges: HomeNudge[] = [];

  if (highRiskItems > 0) {
    nudges.push({
      tone: "warning",
      title: `${highRiskItems} high-risk account${highRiskItems === 1 ? "" : "s"} need attention`,
      description: "Prioritize 90+ and high-value receivables first.",
      href: "/collections?system_view=90-plus-high-value",
    });
  }

  if (brokenPromises > 0) {
    nudges.push({
      tone: "info",
      title: `${brokenPromises} promise${brokenPromises === 1 ? "" : "s"} to pay need review`,
      description: "Review broken or due promises and choose the next action.",
      href: "/promises-to-pay",
    });
  }

  if (reconciliationItems > 0) {
    nudges.push({
      tone: "warning",
      title: `${reconciliationItems} reconciliation item${reconciliationItems === 1 ? "" : "s"} need review`,
      description: "Resolve mismatch or pending tie-out items before close.",
      href: "/reconciliation",
    });
  }

  if (nudges.length === 0) {
    nudges.push({
      tone: "success",
      title: "No urgent nudges right now",
      description: "Open the focus queue or review published snapshots.",
      href: "/focus",
    });
  }

  return nudges;
}

async function resolveDashboardEntity(user: AuthenticatedUser) {
  if (user.role !== role_enum.ANALYST) return "ALL";
  if (!user.entityIdScope) return "IND";

  const entity = await getPrisma().entities.findUnique({
    where: { id: user.entityIdScope },
    select: { code: true },
  });

  return entity?.code === "UAE" ? "UAE" : "IND";
}

async function countTodayActions(user: AuthenticatedUser, now: Date) {
  if (user.role === role_enum.CFO) return 0;

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const [auditActions, followUps] = await Promise.all([
    getPrisma().audit_log.count({
      where: {
        actor_user_id: user.id,
        created_at: { gte: start, lt: end },
        action: {
          in: [
            "collection_task.create",
            "collection_task.complete",
            "collection_task.snooze",
            "collection_task.status_change",
            "promise_to_pay.create",
            "promise_to_pay.patch",
            "dispute_case.create",
            "dispute_case.patch",
          ],
        },
      },
    }),
    getPrisma().follow_ups.count({
      where: {
        logged_by: user.id,
        logged_at: { gte: start, lt: end },
      },
    }),
  ]);

  return auditActions + followUps;
}

export async function getHomeCommandCenter(
  user: AuthenticatedUser,
  now = new Date(),
): Promise<HomeCommandCenter> {
  assertNotPending(user);

  const [focus, completed, dashboardEntity] = await Promise.all([
    getFocusQueue({ asOfDate: now, limit: 7 }, user),
    countTodayActions(user, now),
    resolveDashboardEntity(user),
  ]);

  let dashboard: DashboardResponse | null = null;
  let dashboardError: string | null = null;
  try {
    dashboard = await getDashboard({ entity: dashboardEntity, as_of: "latest" });
  } catch (error) {
    dashboardError =
      error instanceof Error ? error.message : "Dashboard data unavailable.";
  }

  const brokenPromises = focus.items.filter((item) => item.type === "PTP").length;
  const highRiskItems = focus.items.filter(
    (item) => item.priority_score >= 85 || item.status.includes("90"),
  ).length;
  const reconciliationItems = focus.items.filter(
    (item) => item.type === "RECONCILIATION",
  ).length;

  return {
    dashboard,
    dashboard_error: dashboardError,
    focus_items: focus.items,
    focus_total: focus.total,
    daily_goal: buildDailyGoal({ completed, target: 10 }),
    nudges: buildHomeNudges({
      brokenPromises,
      highRiskItems,
      reconciliationItems,
    }),
    is_read_only: focus.is_read_only,
  };
}
```

- [ ] **Step 4: Verify home service**

Run:

```bash
npm test -- src/server/__tests__/home-service.test.ts
npm run typecheck
```

Expected: both pass.

## Task 4: Today's Focus Home Page

**Files:**

- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace smoke page with command center**

Use `requirePageRole`, `getHomeCommandCenter`, `MetricCard`, `Panel`, `RightRail`, `StatusTag`, `MiniSparkline`, and `ProgressBar`.

The page must render these sections:

```tsx
<PageHeader title="Today's Focus">
  Prioritize the highest-risk receivables first.
</PageHeader>
```

Metric cards:

- Total Outstanding.
- Overdue.
- 90+ Parties.
- Focus Items.
- Default Credit Terms.

Main table columns:

- Work item.
- Entity.
- Status.
- Due.
- Next action.
- Priority.

Right rail:

- Daily Goal.
- Reminders & Nudges.
- Quick Actions.
- Recent Activity or dashboard error.

- [ ] **Step 2: Use dashboard fallbacks without blank cards**

When `home.dashboard` is null, render:

```tsx
<EmptyState
  title="Publish a snapshot to calculate ageing"
  description={home.dashboard_error ?? "No published dashboard data is available yet."}
  action={<Link className="text-sm font-medium text-[var(--color-accent)]" href="/upload">Upload workbook</Link>}
/>
```

- [ ] **Step 3: Render focus queue empty state**

When `home.focus_items.length === 0`, render:

```tsx
<EmptyState
  title="No focus items in your scope"
  description="Open invoices, staging blockers, broken promises, and reconciliation mismatches will appear here."
  action={<Link className="text-sm font-medium text-[var(--color-accent)]" href="/invoices">View invoices</Link>}
/>
```

- [ ] **Step 4: Verify page**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

## Task 5: Accounts Workspace

**Files:**

- Create: `src/server/accounts/service.ts`
- Create: `src/server/__tests__/accounts-service.test.ts`
- Create: `src/app/accounts/page.tsx`
- Modify: `src/app/party/[canonicalId]/page.tsx`

- [ ] **Step 1: Write aggregation tests**

Create `src/server/__tests__/accounts-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { summarizeAccount } from "@/server/accounts/service";

describe("account aggregation helpers", () => {
  it("summarizes open invoice exposure and worst bucket", () => {
    const summary = summarizeAccount({
      invoices: [
        { outstanding_amount: "100.00", bucket: "0_30", active_exception_count: 0 },
        { outstanding_amount: "250.00", bucket: "90_PLUS", active_exception_count: 2 },
      ],
    });

    expect(summary.total_outstanding).toBe("350.00");
    expect(summary.overdue_amount).toBe("350.00");
    expect(summary.worst_bucket).toBe("90_PLUS");
    expect(summary.active_exception_count).toBe(2);
    expect(summary.collection_health).toBe("At Risk");
  });

  it("keeps accounts with no invoices in a neutral state", () => {
    expect(summarizeAccount({ invoices: [] })).toEqual({
      total_outstanding: "0.00",
      overdue_amount: "0.00",
      worst_bucket: "NOT_DUE",
      active_exception_count: 0,
      collection_health: "Good",
    });
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm test -- src/server/__tests__/accounts-service.test.ts
```

Expected: fails because the accounts service does not exist.

- [ ] **Step 3: Implement accounts service**

Create `src/server/accounts/service.ts` with:

```ts
import "server-only";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { role_enum } from "@/generated/prisma/enums";

type AccountInvoiceInput = {
  outstanding_amount: string | null;
  bucket: string | null;
  active_exception_count: number;
};

export interface AccountSummary {
  total_outstanding: string;
  overdue_amount: string;
  worst_bucket: string;
  active_exception_count: number;
  collection_health: "Good" | "Watch" | "At Risk";
}

export interface AccountListRow extends AccountSummary {
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  currency_display: string;
  open_invoice_count: number;
}

const BUCKET_RANK: Record<string, number> = {
  NOT_DUE: 0,
  "0_30": 1,
  "31_60": 2,
  "61_90": 3,
  "90_PLUS": 4,
};

function toCents(value: string | null) {
  const numeric = Number(value ?? "0");
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function fromCents(value: number) {
  return (value / 100).toFixed(2);
}

export function summarizeAccount({
  invoices,
}: {
  invoices: AccountInvoiceInput[];
}): AccountSummary {
  let total = 0;
  let overdue = 0;
  let worstBucket = "NOT_DUE";
  let activeExceptionCount = 0;

  for (const invoice of invoices) {
    const amount = toCents(invoice.outstanding_amount);
    const bucket = invoice.bucket ?? "NOT_DUE";
    total += amount;
    if (bucket !== "NOT_DUE") overdue += amount;
    if ((BUCKET_RANK[bucket] ?? 0) > (BUCKET_RANK[worstBucket] ?? 0)) {
      worstBucket = bucket;
    }
    activeExceptionCount += invoice.active_exception_count;
  }

  const collectionHealth =
    worstBucket === "90_PLUS" || activeExceptionCount > 0
      ? "At Risk"
      : worstBucket === "61_90" || worstBucket === "31_60"
        ? "Watch"
        : "Good";

  return {
    total_outstanding: fromCents(total),
    overdue_amount: fromCents(overdue),
    worst_bucket: worstBucket,
    active_exception_count: activeExceptionCount,
    collection_health: collectionHealth,
  };
}

export async function listAccounts(
  user: AuthenticatedUser,
): Promise<AccountListRow[]> {
  assertNotPending(user);

  const accounts = await getPrisma().parties_canonical.findMany({
    where:
      user.role === role_enum.ANALYST && user.entityIdScope
        ? { entity_id: user.entityIdScope }
        : {},
    orderBy: { name: "asc" },
    take: 100,
    include: {
      entities: { select: { code: true, base_currency: true } },
      invoices: {
        where: { status: "OPEN" },
        include: {
          invoice_snapshots: {
            orderBy: { as_of_date: "desc" },
            take: 1,
            select: { outstanding_amount: true, bucket: true },
          },
          exception_tags: {
            where: { status: "ACTIVE" },
            select: { id: true },
          },
        },
      },
    },
  });

  return accounts.map((account) => {
    const invoiceInputs = account.invoices.map((invoice) => ({
      outstanding_amount:
        invoice.invoice_snapshots.at(0)?.outstanding_amount?.toString() ??
        invoice.amount.toString(),
      bucket: invoice.invoice_snapshots.at(0)?.bucket ?? "NOT_DUE",
      active_exception_count: invoice.exception_tags.length,
    }));
    const summary = summarizeAccount({ invoices: invoiceInputs });

    return {
      canonical_id: account.id,
      canonical_name: account.name,
      entity_code: account.entities?.code ?? "UNKNOWN",
      currency_display: account.entities?.base_currency ?? "INR",
      open_invoice_count: account.invoices.length,
      ...summary,
    };
  });
}
```

- [ ] **Step 4: Create Accounts page**

Create `src/app/accounts/page.tsx` using `PageFrame`, `PageHeader`, `MetricCard`, `SavedViewTabs`, `TableShell`, `EmptyTableRow`, and `StatusTag`.

Table columns:

- Account Name.
- Entity.
- Total Outstanding.
- Overdue.
- Open Invoices.
- Worst Bucket.
- Collection Health.
- Next Action.

Rows link to `/party/${account.canonical_id}`. Empty state links to `/upload`.

- [ ] **Step 5: Upgrade party detail layout**

Keep existing `getPartyDetail` data. Re-layout `/party/[canonicalId]` to:

- Header with back to Accounts.
- Action buttons for Log Activity, Send Reminder, Create Promise, Escalate. Buttons are disabled for CFO.
- KPI strip.
- Tabs rendered as static anchors: Overview, Invoices, Contacts, Activity, Documents, Workflows.
- Main grid: Open Invoices table and right rail with Next Best Action, Recent Reminders empty state, Quick Actions.

- [ ] **Step 6: Verify accounts**

Run:

```bash
npm test -- src/server/__tests__/accounts-service.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

## Task 6: Invoice Ageing Workbench

**Files:**

- Create: `src/server/invoices/workbench.ts`
- Create: `src/server/__tests__/invoice-workbench.test.ts`
- Modify: `src/app/invoices/page.tsx`

- [ ] **Step 1: Write bucket summary tests**

Create `src/server/__tests__/invoice-workbench.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildBucketSummaries } from "@/server/invoices/workbench";

describe("invoice workbench summaries", () => {
  it("aggregates invoice amounts by ageing bucket", () => {
    expect(
      buildBucketSummaries([
        { amount: "100.00", bucket: "NOT_DUE" },
        { amount: "50.00", bucket: "31_60" },
        { amount: "75.00", bucket: "31_60" },
        { amount: "25.00", bucket: "90_PLUS" },
      ]),
    ).toEqual([
      { bucket: "NOT_DUE", label: "Current", amount: 100, count: 1, percent: 40 },
      { bucket: "0_30", label: "1-30 Days", amount: 0, count: 0, percent: 0 },
      { bucket: "31_60", label: "31-60 Days", amount: 125, count: 2, percent: 50 },
      { bucket: "61_90", label: "61-90 Days", amount: 0, count: 0, percent: 0 },
      { bucket: "90_PLUS", label: "91+ Days", amount: 25, count: 1, percent: 10 },
    ]);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- src/server/__tests__/invoice-workbench.test.ts
```

Expected: fails because `workbench.ts` does not exist.

- [ ] **Step 3: Implement workbench helpers**

Create `src/server/invoices/workbench.ts`:

```ts
export type WorkbenchBucket =
  | "NOT_DUE"
  | "0_30"
  | "31_60"
  | "61_90"
  | "90_PLUS";

export interface BucketSummaryInput {
  amount: string;
  bucket: string | null;
}

export interface BucketSummary {
  bucket: WorkbenchBucket;
  label: string;
  amount: number;
  count: number;
  percent: number;
}

const BUCKETS: Array<{ bucket: WorkbenchBucket; label: string }> = [
  { bucket: "NOT_DUE", label: "Current" },
  { bucket: "0_30", label: "1-30 Days" },
  { bucket: "31_60", label: "31-60 Days" },
  { bucket: "61_90", label: "61-90 Days" },
  { bucket: "90_PLUS", label: "91+ Days" },
];

export function buildBucketSummaries(
  rows: BucketSummaryInput[],
): BucketSummary[] {
  const totals = new Map<WorkbenchBucket, { amount: number; count: number }>();
  let grandTotal = 0;

  for (const { bucket } of BUCKETS) {
    totals.set(bucket, { amount: 0, count: 0 });
  }

  for (const row of rows) {
    const bucket = BUCKETS.some((item) => item.bucket === row.bucket)
      ? (row.bucket as WorkbenchBucket)
      : "NOT_DUE";
    const amount = Number(row.amount);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const current = totals.get(bucket)!;
    current.amount += safeAmount;
    current.count += 1;
    grandTotal += safeAmount;
  }

  return BUCKETS.map(({ bucket, label }) => {
    const item = totals.get(bucket)!;
    return {
      bucket,
      label,
      amount: Number(item.amount.toFixed(2)),
      count: item.count,
      percent:
        grandTotal > 0 ? Math.round((item.amount / grandTotal) * 100) : 0,
    };
  });
}
```

- [ ] **Step 4: Replace `/invoices` UI**

Keep `listInvoices` for the data source. Use:

- `PageFrame`.
- `PageHeader`.
- `MetricCard`.
- `SavedViewTabs`.
- Filter bar form.
- Bucket summary cards.
- Horizontal distribution bar.
- Dense invoice table.
- Empty state.

Use `StatusTag` for `bucket` and `status`. Use `formatCurrency` and `formatDate` from `src/lib/format.ts`.

- [ ] **Step 5: Add safe bulk action bar visual**

Render a disabled bulk action toolbar at the top of the table with copy:

```tsx
<div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
  <span>Bulk actions become available after selecting invoices.</span>
</div>
```

No hidden mutation is added in this task.

- [ ] **Step 6: Verify invoice workbench**

Run:

```bash
npm test -- src/server/__tests__/invoice-workbench.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

## Task 7: Collections Board

**Files:**

- Create: `src/server/collection-tasks/board.ts`
- Create: `src/server/__tests__/collection-board.test.ts`
- Modify: `src/app/collections/page.tsx`

- [ ] **Step 1: Write grouping test**

Create `src/server/__tests__/collection-board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupCollectionBoard } from "@/server/collection-tasks/board";

describe("collection board grouping", () => {
  it("places tasks into launch board columns", () => {
    const board = groupCollectionBoard([
      { id: "1", status: "SUGGESTED", reason_code: "NINETY_PLUS", priority_score: 91 },
      { id: "2", status: "OPEN", reason_code: "STALE_FOLLOW_UP", priority_score: 70 },
      { id: "3", status: "IN_PROGRESS", reason_code: "BROKEN_PROMISE", priority_score: 95 },
      { id: "4", status: "SNOOZED", reason_code: "HIGH_VALUE", priority_score: 75 },
      { id: "5", status: "DONE", reason_code: "MANUAL", priority_score: 20 },
    ]);

    expect(board.map((column) => [column.id, column.tasks.map((task) => task.id)])).toEqual([
      ["new", ["1", "2"]],
      ["reminder-sent", []],
      ["promise-to-pay", ["3"]],
      ["escalated", []],
      ["payment-expected", ["4"]],
      ["closed", ["5"]],
    ]);
  });
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npm test -- src/server/__tests__/collection-board.test.ts
```

Expected: fails because `board.ts` does not exist.

- [ ] **Step 3: Implement board grouping**

Create `src/server/collection-tasks/board.ts`:

```ts
export interface BoardTaskInput {
  id: string;
  status: string;
  reason_code: string;
  priority_score: number;
}

export interface BoardColumn<TTask extends BoardTaskInput = BoardTaskInput> {
  id:
    | "new"
    | "reminder-sent"
    | "promise-to-pay"
    | "escalated"
    | "payment-expected"
    | "closed";
  label: string;
  tasks: TTask[];
}

export function groupCollectionBoard<TTask extends BoardTaskInput>(
  tasks: TTask[],
): BoardColumn<TTask>[] {
  const columns: BoardColumn<TTask>[] = [
    { id: "new", label: "New", tasks: [] },
    { id: "reminder-sent", label: "Reminder Sent", tasks: [] },
    { id: "promise-to-pay", label: "Promise to Pay", tasks: [] },
    { id: "escalated", label: "Escalated", tasks: [] },
    { id: "payment-expected", label: "Payment Expected", tasks: [] },
    { id: "closed", label: "Closed", tasks: [] },
  ];
  const byId = new Map(columns.map((column) => [column.id, column]));

  for (const task of tasks) {
    if (task.status === "DONE" || task.status === "DISMISSED") {
      byId.get("closed")!.tasks.push(task);
    } else if (task.status === "SNOOZED") {
      byId.get("payment-expected")!.tasks.push(task);
    } else if (task.reason_code === "BROKEN_PROMISE") {
      byId.get("promise-to-pay")!.tasks.push(task);
    } else if (task.reason_code === "DISPUTE_OPEN" || task.priority_score >= 96) {
      byId.get("escalated")!.tasks.push(task);
    } else {
      byId.get("new")!.tasks.push(task);
    }
  }

  return columns;
}
```

- [ ] **Step 4: Add board tabs to Collections page**

Use existing `listCollectionTasks`. Render:

- Header with campaign selector visual and disabled "Run Batch Reminder" if email rules are not active in the page data.
- Tabs: Board, Calendar, Queue.
- Board columns from `groupCollectionBoard`.
- Keep the existing `TaskTable` in the Queue tab or below the board.
- Right rail with collection progress, upcoming calls empty state, promises due today link, queue overview.

This task does not add drag-and-drop. Cards link to `/collections?task=<id>`.

- [ ] **Step 5: Verify collections board**

Run:

```bash
npm test -- src/server/__tests__/collection-board.test.ts
npm run typecheck
npm run lint
```

Expected: all pass.

## Task 8: Reconciliation, Workflows, Reports, Admin Upgrade

**Files:**

- Create: `src/app/reconciliation/page.tsx`
- Create: `src/app/workflows/page.tsx`
- Create: `src/app/reports/page.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/reconciliation/page.tsx`

- [ ] **Step 1: Add top-level Reconciliation Center**

Create `src/app/reconciliation/page.tsx` with page auth for Analyst/CFO/Admin. Query the same recent published snapshots shape used by `src/app/admin/reconciliation/page.tsx`, but allow read-only CFO view and analyst entity scope.

Render:

- Stepper row.
- Source import cards for supported snapshots.
- Match/reconciliation metric cards.
- Exceptions table.
- Right rail with selected transaction empty state.

Do not mention bank/payment matching as active. Use "Snapshot Tie-Out" copy.

- [ ] **Step 2: Add Core Workflows page**

Create `src/app/workflows/page.tsx` with:

- Daily Analyst Flow band.
- Collections Lifecycle band.
- Reconciliation & Close band.
- Right rail Platform Functions and At a Glance.

Each card links to existing routes. Workflow Builder controls show `StatusTag status="WORKFLOW_DISABLED"` and disabled Test/Publish buttons.

- [ ] **Step 3: Add Reports shell**

Create `src/app/reports/page.tsx` with CFO/Admin/Analyst read access. Render:

- Filters.
- KPI cards from `getDashboard({ entity: "ALL", as_of: "latest" })` for CFO/Admin and entity-scoped dashboard for Analyst.
- Existing export links: `/api/reports/ageing`.
- Empty state when dashboard is unavailable.

Use caveat copy for DSO if DSO appears. This first pass can omit DSO rather than show an unsupported metric.

- [ ] **Step 4: Upgrade Admin layout**

Refactor `src/app/admin/page.tsx` to:

- Use `PageFrame` and `PageHeader`.
- Render settings subnav.
- Keep current users table.
- Add Notification Templates and Approval Rules panels as disabled/read-only shells unless existing routes support save.
- Add right role-permissions drawer visual with disabled toggles and "Save Changes" disabled.

Every active link should point to existing admin routes.

- [ ] **Step 5: Align admin reconciliation**

Keep `/admin/reconciliation`, but add a link to `/reconciliation` and use shared token classes. Do not delete the route.

- [ ] **Step 6: Verify upgraded surfaces**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

## Task 9: Browser Verification And Polish

**Files:**

- Modify: page/component files touched in Tasks 1-8.
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected:

- Typecheck passes.
- Lint passes.
- Tests pass.
- Build passes.

If `npm run build` collides with an active dev `.next`, use the known clean build verification path with `NEXT_DIST_DIR=.next-build-verify`, then restore config exactly.

- [ ] **Step 2: Start or reuse dev server**

If no dev server is running, run:

```bash
npm run dev
```

Open the app in the in-app browser at the reported localhost URL.

- [ ] **Step 3: Visual verification checklist**

Verify these routes:

- `/`
- `/accounts`
- `/invoices`
- `/collections`
- `/reconciliation`
- `/workflows`
- `/reports`
- `/admin`

Check:

- Sidebar/nav consistency.
- Warm light-only theme.
- Topbar search/entity/date/user controls.
- No dark toggle.
- Table text does not overflow at desktop width.
- Empty states appear where data is unavailable.
- CFO/PENDING mutation affordances are hidden or disabled on routes where those roles can render.
- No payment portal/payment receipt UI is shown as active.

- [ ] **Step 4: Update progress**

Add a short bullet to `PROGRESS.md` under Implemented Surface:

```md
- **Warm command-center UI slice (Phase 9)** - light-only workspace shell, Today's Focus home, Accounts workspace, Invoice Ageing Workbench, Collections board, Reconciliation Center, Workflows, Reports, and Admin surfaces upgraded with shared dense-table, KPI, empty-state, and right-rail patterns.
```

- [ ] **Step 5: Final verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all pass after the docs update.

---

## Self-Review

Spec coverage:

- Warm light-only shell: Task 1.
- Shared product components: Task 2.
- Today's Focus: Tasks 3-4.
- Accounts and account detail: Task 5.
- Invoice Ageing Workbench: Task 6.
- Collections board: Task 7.
- Reconciliation, Workflows, Reports, Admin: Task 8.
- Loading/empty/error and no fake payment data: Tasks 2, 4, 6, 8, 9.
- Verification: Task 9.

Scope decisions:

- Workflow execution engine is excluded and represented as disabled UI.
- Payment matching and payment portal links are excluded.
- Email reminder delivery remains gated and disabled unless existing email rules explicitly permit it.
- No schema changes are required.

Commands:

- Use `npm` only.
- Preserve route-level RBAC and existing audit-log behavior.
- Do not edit `02_HANDOFF_SPEC.md`.
