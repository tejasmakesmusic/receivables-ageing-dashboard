export interface CommandItem {
  description: string;
  href: string;
  id: string;
  keywords: readonly string[];
  label: string;
}

export interface ScoredCommandItem extends CommandItem {
  score: number;
}

export interface CommandGroup {
  id: string;
  items: readonly CommandItem[];
  label: string;
}

export interface FilteredCommandGroup {
  id: string;
  items: readonly ScoredCommandItem[];
  label: string;
}

export const COMMAND_GROUPS = [
  {
    id: "workspaces",
    label: "Workspaces",
    items: [
      {
        description: "Daily command center and focus queue",
        href: "/",
        id: "today-focus",
        keywords: ["home", "focus", "daily", "queue", "today"],
        label: "Today's Focus",
      },
      {
        description: "Canonical party exposure and relationship health",
        href: "/parties",
        id: "accounts",
        keywords: ["customers", "parties", "accounts", "health"],
        label: "Parties",
      },
      {
        description: "Ageing workbench and invoice review",
        href: "/invoices",
        id: "invoices",
        keywords: ["invoice", "ageing", "aging", "buckets", "overdue"],
        label: "Invoice Ageing Workbench",
      },
      {
        description: "Task board, calendar, and execution queue",
        href: "/tasks",
        id: "collections",
        keywords: ["collections", "tasks", "board", "calendar", "promises"],
        label: "Tasks",
      },
      {
        description: "Snapshot tie-out and reconciliation status",
        href: "/reconciliation",
        id: "reconciliation",
        keywords: ["reconcile", "tie-out", "closing", "delta"],
        label: "Reconciliation Center",
      },
      {
        description: "Workflow map across AR operations",
        href: "/workflows",
        id: "workflows",
        keywords: ["workflow", "process", "lifecycle", "automation"],
        label: "Core Workflows",
      },
      {
        description: "Executive reports and ageing export",
        href: "/reports",
        id: "reports",
        keywords: ["reports", "cfo", "dashboard", "export"],
        label: "Reports",
      },
      {
        description: "Users, roles, rules, and audit controls",
        href: "/admin",
        id: "admin",
        keywords: ["admin", "settings", "users", "roles"],
        label: "Admin & Configuration",
      },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    items: [
      {
        description: "Upload and stage a receivables workbook",
        href: "/upload",
        id: "upload-snapshot",
        keywords: ["upload", "snapshot", "workbook", "import"],
        label: "Upload Snapshot",
      },
      {
        description: "Download the current ageing register",
        href: "/api/reports/ageing",
        id: "export-ageing",
        keywords: ["download", "xlsx", "excel", "ageing", "aging", "export"],
        label: "Export Ageing Report",
      },
      {
        description: "Review 90+ and high-value collection work",
        href: "/tasks?system_view=90_PLUS_HIGH_VALUE",
        id: "view-high-risk",
        keywords: ["90", "high", "risk", "value", "overdue"],
        label: "Open 90+ / High Value Work",
      },
      {
        description: "Review broken promise-to-pay tasks",
        href: "/tasks?system_view=BROKEN_PTP",
        id: "view-broken-ptp",
        keywords: ["broken", "ptp", "promise", "pay"],
        label: "Open Broken PTP View",
      },
      {
        description: "Review due collection tasks",
        href: "/tasks?system_view=DUE_TODAY",
        id: "view-due-today",
        keywords: ["due", "today", "tasks", "follow-up"],
        label: "Open Due Today View",
      },
    ],
  },
  {
    id: "records",
    label: "Records",
    items: [
      {
        description: "Promises to pay list",
        href: "/promises-to-pay",
        id: "promises-to-pay",
        keywords: ["promise", "ptp", "commitment"],
        label: "Promises to Pay",
      },
      {
        description: "Dispute case list",
        href: "/dispute-cases",
        id: "dispute-cases",
        keywords: ["dispute", "case", "exceptions"],
        label: "Dispute Cases",
      },
      {
        description: "Follow-up activity log",
        href: "/follow-ups",
        id: "follow-ups",
        keywords: ["follow-up", "activity", "calls", "notes"],
        label: "Follow-ups",
      },
      {
        description: "Published and staged snapshots",
        href: "/snapshots",
        id: "snapshots",
        keywords: ["snapshot", "staging", "publish"],
        label: "Snapshots",
      },
    ],
  },
] as const satisfies readonly CommandGroup[];

const DEFAULT_COMMAND_IDS = [
  "today-focus",
  "accounts",
  "invoices",
  "collections",
  "upload-snapshot",
  "reports",
] as const;
const DEFAULT_COMMAND_ID_SET = new Set<string>(DEFAULT_COMMAND_IDS);

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreItem(item: CommandItem, terms: string[]) {
  const label = normalize(item.label);
  const href = normalize(item.href);
  const description = normalize(item.description);
  const keywords = item.keywords.map(normalize);
  let score = 0;

  for (const term of terms) {
    if (label === term) score += 10;
    if (label.startsWith(term)) score += 6;
    if (label.includes(term)) score += 4;
    if (keywords.some((keyword) => keyword === term)) score += 5;
    if (keywords.some((keyword) => keyword.includes(term))) score += 3;
    if (href.includes(term)) score += 2;
    if (description.includes(term)) score += 1;
  }

  return score;
}

export function flattenCommandItems(
  groups: readonly CommandGroup[] = COMMAND_GROUPS,
): CommandItem[] {
  return groups.flatMap((group) => [...group.items]);
}

export function filterCommandItems(
  query: string,
  groups: readonly CommandGroup[] = COMMAND_GROUPS,
): CommandItem[] {
  const items = filterCommandItemsGrouped(query, groups).flatMap((group) => [...group.items]);
  if (!normalize(query)) {
    const order = new Map<string, number>(DEFAULT_COMMAND_IDS.map((id, i) => [id, i]));
    return items.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  }
  return items;
}

export function filterCommandItemsGrouped(
  query: string,
  groups: readonly CommandGroup[] = COMMAND_GROUPS,
): FilteredCommandGroup[] {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    const defaults = DEFAULT_COMMAND_ID_SET;
    return groups
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => defaults.has(item.id))
          .map((item) => ({ ...item, score: 0 })),
      }))
      .filter((group) => group.items.length > 0);
  }

  const terms = normalizedQuery.split(" ").filter(Boolean);
  const rankedGroups = groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => ({ item, score: scoreItem(item, terms) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
        .map(({ item, score }) => ({ ...item, score })),
    }))
    .filter((group) => group.items.length > 0);

  return rankedGroups;
}
