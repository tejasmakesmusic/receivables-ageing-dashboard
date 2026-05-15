export type StatusTagTone =
  | "neutral"
  | "info"
  | "current"
  | "warning"
  | "alert"
  | "danger";

export interface StatusTagDefinition {
  label: string;
  className: string;
  tone: StatusTagTone;
}

const TONE_CLASSES: Record<StatusTagTone, string> = {
  neutral:
    "border-transparent bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]",
  info: "border-transparent bg-[var(--color-status-info-bg)] text-[var(--color-status-info-text)]",
  current:
    "border-transparent bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]",
  warning:
    "border-transparent bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]",
  alert:
    "border-transparent bg-[var(--color-status-alert-bg)] text-[var(--color-status-alert-text)]",
  danger:
    "border-transparent bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]",
};

function tag(label: string, tone: StatusTagTone): StatusTagDefinition {
  return {
    label,
    tone,
    className: TONE_CLASSES[tone],
  };
}

export const STATUS_TAGS = {
  NOT_DUE: tag("Not Due", "current"),
  DUE_TODAY: tag("Due Today", "warning"),
  "0_30": tag("0-30", "neutral"),
  "31_60": tag("31-60", "warning"),
  "61_90": tag("61-90", "alert"),
  "90_PLUS": tag("90+", "danger"),

  OPEN: tag("Open", "info"),
  SETTLED: tag("Settled", "current"),

  STAGED: tag("Staged", "warning"),
  PUBLISHED: tag("Published", "current"),
  DISCARDED: tag("Discarded", "neutral"),

  TASK_SUGGESTED: tag("Suggested", "neutral"),
  TASK_OPEN: tag("Open", "info"),
  TASK_IN_PROGRESS: tag("In Progress", "warning"),
  TASK_SNOOZED: tag("Snoozed", "neutral"),
  TASK_DONE: tag("Done", "current"),
  TASK_DISMISSED: tag("Dismissed", "neutral"),

  PTP_OPEN: tag("PTP Open", "info"),
  PTP_KEPT: tag("PTP Kept", "current"),
  PTP_BROKEN: tag("PTP Broken", "danger"),
  PTP_CANCELLED: tag("PTP Cancelled", "neutral"),

  DISPUTE_OPEN: tag("Dispute Open", "warning"),
  DISPUTE_IN_REVIEW: tag("Dispute In Review", "warning"),
  DISPUTE_WAITING_ON_CUSTOMER: tag("Waiting On Customer", "info"),
  DISPUTE_RESOLVED: tag("Dispute Resolved", "current"),
  DISPUTE_CLOSED: tag("Dispute Closed", "neutral"),

  MATCHED: tag("Matched", "current"),
  MISMATCH: tag("Mismatch", "danger"),
  MISMATCHED: tag("Mismatched", "danger"),
  UNRECONCILED: tag("Unreconciled", "warning"),
  RECONCILIATION_PENDING: tag("Reconciliation Pending", "warning"),

  OVERRIDE: tag("Admin Override", "warning"),
  READ_ONLY: tag("Read-only", "neutral"),
  NO_DATA: tag("No Data", "neutral"),
  FOLLOW_UP_DUE: tag("Follow-up Due", "warning"),
  STAGING_BLOCKED: tag("Staging Blocked", "danger"),
  WORKFLOW_DRAFT: tag("Draft", "info"),
  WORKFLOW_DISABLED: tag("Unavailable", "neutral"),

  // Staging resolution states
  EXACT: tag("Auto-matched", "current"),
  FUZZY_HIGH: tag("High Match", "info"),
  FUZZY_LOW: tag("Low Match", "warning"),
  UNMAPPED: tag("Unmapped", "danger"),
  RESOLVED: tag("Resolved", "current"),
  DISMISSED: tag("Reviewed", "neutral"),
  PARSE_ERROR: tag("Parse Error", "danger"),
  NO_CREDIT_DAYS: tag("No Credit Days", "danger"),
  GATE_OK: tag("Ready to Publish", "current"),
} as const satisfies Record<string, StatusTagDefinition>;

export type StatusTagKey = keyof typeof STATUS_TAGS;

function formatStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getStatusTag(
  status: string | null | undefined,
): StatusTagDefinition {
  if (!status) {
    return tag("Unknown", "neutral");
  }

  return (
    STATUS_TAGS[status as StatusTagKey] ??
    tag(formatStatusLabel(status), "neutral")
  );
}
