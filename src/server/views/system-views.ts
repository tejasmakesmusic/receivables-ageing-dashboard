import {
  collection_task_reason_code,
  collection_task_status,
} from "@/generated/prisma/enums";

export const SYSTEM_VIEW_IDS = [
  "90_PLUS_HIGH_VALUE",
  "BROKEN_PTP",
  "UNMAPPED_PARTIES",
  "RECONCILIATION_MISMATCHES",
  "DUE_TODAY",
] as const;

export type SystemViewId = (typeof SYSTEM_VIEW_IDS)[number];
export type SystemViewSurface = "collections" | "invoices";

export interface SystemViewDefinition {
  description: string;
  id: SystemViewId;
  label: string;
  surfaces: readonly SystemViewSurface[];
}

export interface CollectionTaskSystemViewFilter {
  dueDateOnOrBefore?: Date;
  reasonCodes?: readonly collection_task_reason_code[];
  statuses: readonly collection_task_status[];
}

export interface InvoiceSystemViewParams {
  overdue_bucket?: string;
  status?: "OPEN" | "SETTLED";
}

interface SystemViewTarget {
  params?: readonly [string, string][];
  path: string;
}

const ACTIVE_COLLECTION_STATUSES = [
  collection_task_status.SUGGESTED,
  collection_task_status.OPEN,
  collection_task_status.IN_PROGRESS,
] as const;

const DUE_COLLECTION_STATUSES = [
  ...ACTIVE_COLLECTION_STATUSES,
  collection_task_status.SNOOZED,
] as const;

const SYSTEM_VIEW_DEFINITIONS: readonly (SystemViewDefinition & {
  targets: Partial<Record<SystemViewSurface, SystemViewTarget>>;
})[] = [
  {
    description: "Open 90+ invoices and collection work flagged as 90+ or high value.",
    id: "90_PLUS_HIGH_VALUE",
    label: "90+ / High value",
    surfaces: ["collections", "invoices"],
    targets: {
      collections: { path: "/collections" },
      invoices: {
        path: "/invoices",
        params: [
          ["status", "OPEN"],
          ["overdue_bucket", "90_PLUS"],
        ],
      },
    },
  },
  {
    description: "Collection tasks created from broken promise-to-pay records.",
    id: "BROKEN_PTP",
    label: "Broken PTP",
    surfaces: ["collections"],
    targets: {
      collections: { path: "/collections" },
    },
  },
  {
    description: "Staged snapshot rows blocked by party mapping.",
    id: "UNMAPPED_PARTIES",
    label: "Unmapped parties",
    surfaces: ["invoices"],
    targets: {
      invoices: {
        path: "/snapshots",
        params: [["status", "STAGED"]],
      },
    },
  },
  {
    description: "Published snapshots with reconciliation mismatches.",
    id: "RECONCILIATION_MISMATCHES",
    label: "Reconciliation mismatches",
    surfaces: ["invoices"],
    targets: {
      invoices: { path: "/admin/reconciliation" },
    },
  },
  {
    description: "Active and snoozed collection tasks due today or earlier.",
    id: "DUE_TODAY",
    label: "Due today",
    surfaces: ["collections"],
    targets: {
      collections: { path: "/collections" },
    },
  },
];

function startOfUtcDate(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function buildHref(target: SystemViewTarget, viewId: SystemViewId): string {
  const params = new URLSearchParams([["system_view", viewId]]);

  for (const [key, value] of target.params ?? []) {
    params.set(key, value);
  }

  return `${target.path}?${params.toString()}`;
}

export function parseSystemViewId(
  value: string | null | undefined,
): SystemViewId | null {
  return SYSTEM_VIEW_IDS.find((id) => id === value) ?? null;
}

export function getSystemViewsForSurface(
  surface: SystemViewSurface,
): readonly SystemViewDefinition[] {
  return SYSTEM_VIEW_DEFINITIONS.filter((view) =>
    view.surfaces.includes(surface),
  );
}

export function buildSystemViewHref(
  viewId: SystemViewId,
  surface: SystemViewSurface,
): string {
  const view = SYSTEM_VIEW_DEFINITIONS.find((candidate) => candidate.id === viewId);
  const target = view?.targets[surface];

  if (!target) {
    return `/${surface}?system_view=${viewId}`;
  }

  return buildHref(target, viewId);
}

export function getInvoiceSystemViewParams(
  viewId: SystemViewId | null,
): InvoiceSystemViewParams | null {
  if (viewId === "90_PLUS_HIGH_VALUE") {
    return {
      overdue_bucket: "90_PLUS",
      status: "OPEN",
    };
  }

  return null;
}

export function getCollectionTaskSystemViewFilter(
  viewId: SystemViewId | null,
  today: Date,
): CollectionTaskSystemViewFilter | null {
  if (viewId === "90_PLUS_HIGH_VALUE") {
    return {
      reasonCodes: [
        collection_task_reason_code.NINETY_PLUS,
        collection_task_reason_code.HIGH_VALUE,
      ],
      statuses: ACTIVE_COLLECTION_STATUSES,
    };
  }

  if (viewId === "BROKEN_PTP") {
    return {
      reasonCodes: [collection_task_reason_code.BROKEN_PROMISE],
      statuses: ACTIVE_COLLECTION_STATUSES,
    };
  }

  if (viewId === "DUE_TODAY") {
    return {
      dueDateOnOrBefore: startOfUtcDate(today),
      statuses: DUE_COLLECTION_STATUSES,
    };
  }

  return null;
}
