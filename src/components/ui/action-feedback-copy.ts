export type ActionFeedbackAction =
  | "FOLLOW_UP_LOGGED"
  | "TASK_SNOOZED"
  | "PTP_CREATED"
  | "DISPUTE_RAISED"
  | "RECONCILIATION_SUBMITTED";

export interface ActionFeedbackInput {
  action: ActionFeedbackAction;
  amount?: string | null;
  nextDate?: string | null;
  priorityAfter?: number | null;
  priorityBefore?: number | null;
  reference?: string | null;
  status: string;
}

export interface ActionFeedbackFact {
  label: string;
  value: string;
}

export interface ActionFeedbackModel {
  facts: ActionFeedbackFact[];
  message: string;
  status: string;
  title: string;
}

const ACTION_COPY: Record<
  ActionFeedbackAction,
  {
    dateLabel?: string;
    message: string;
    title: string;
  }
> = {
  FOLLOW_UP_LOGGED: {
    dateLabel: "Next action",
    message: "Record updated with the follow-up details.",
    title: "Follow-up logged",
  },
  TASK_SNOOZED: {
    dateLabel: "Next due",
    message: "Task due date updated.",
    title: "Task snoozed",
  },
  PTP_CREATED: {
    dateLabel: "Promised date",
    message: "Record updated with the promise details.",
    title: "Promise to Pay logged",
  },
  DISPUTE_RAISED: {
    dateLabel: "Expected resolution",
    message: "Dispute case created for review.",
    title: "Dispute raised",
  },
  RECONCILIATION_SUBMITTED: {
    message: "Reconciliation entry saved.",
    title: "Reconciliation submitted",
  },
};

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatPriority(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function buildActionFeedback(
  input: ActionFeedbackInput,
): ActionFeedbackModel {
  const copy = ACTION_COPY[input.action];
  const facts: ActionFeedbackFact[] = [{ label: "Status", value: input.status }];

  if (copy.dateLabel && hasValue(input.nextDate)) {
    facts.push({ label: copy.dateLabel, value: input.nextDate });
  }

  if (hasValue(input.amount)) {
    facts.push({ label: "Amount", value: input.amount });
  }

  if (hasValue(input.reference)) {
    facts.push({ label: "Reference", value: input.reference });
  }

  if (
    typeof input.priorityBefore === "number" &&
    typeof input.priorityAfter === "number"
  ) {
    facts.push({
      label: "Priority",
      value: `${formatPriority(input.priorityBefore)} -> ${formatPriority(
        input.priorityAfter,
      )}`,
    });
  }

  return {
    facts,
    message: copy.message,
    status: input.status,
    title: copy.title,
  };
}
