export interface CommandItem {
  description: string;
  href: string;
  id: string;
  keywords: readonly string[];
  label: string;
}

export interface CommandGroup {
  id: string;
  items: readonly CommandItem[];
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
        description: "Customer exposure and account health",
        href: "/accounts",
        id: "accounts",
        keywords: ["customers", "parties", "accounts", "health"],
        label: "Accounts",
      },
      {
        description: "Ageing workbench and invoice review",
        href: "/invoices",
        id: "invoices",
        keywords: ["invoice", "ageing", "aging", "buckets", "overdue"],
        label: "Invoice Ageing Workbench",
      },
      {
        description: "Collection board, calendar, and task queue",
        href: "/collections",
        id: "collections",
        keywords: ["collections", "tasks", "board", "calendar", "promises"],
        label: "Collections",
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
        href: "/collections?system_view=90_PLUS_HIGH_VALUE",
        id: "view-high-risk",
        keywords: ["90", "high", "risk", "value", "overdue"],
        label: "Open 90+ / High Value Work",
      },
      {
        description: "Review broken promise-to-pay tasks",
        href: "/collections?system_view=BROKEN_PTP",
        id: "view-broken-ptp",
        keywords: ["broken", "ptp", "promise", "pay"],
        label: "Open Broken PTP View",
      },
      {
        description: "Review due collection tasks",
        href: "/collections?system_view=DUE_TODAY",
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
  const items = flattenCommandItems(groups);
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return DEFAULT_COMMAND_IDS.map((id) =>
      items.find((item) => item.id === id),
    ).filter((item): item is CommandItem => Boolean(item));
  }

  const terms = normalizedQuery.split(" ").filter(Boolean);

  return items
    .map((item) => ({ item, score: scoreItem(item, terms) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .map(({ item }) => item);
}
