import { describe, expect, it } from "vitest";
import { buildActionFeedback } from "@/components/ui/action-feedback-copy";

const BANNED_COPY = /\b(great|excellent|congrats|win|won|cash collected|collected cash|closed deal)\b/i;

describe("buildActionFeedback", () => {
  it("builds factual copy for a logged follow-up", () => {
    const feedback = buildActionFeedback({
      action: "FOLLOW_UP_LOGGED",
      nextDate: "2026-05-10",
      status: "FOLLOW_UP_DUE",
    });

    expect(feedback.title).toBe("Follow-up logged");
    expect(feedback.facts).toContainEqual({
      label: "Next action",
      value: "2026-05-10",
    });
    expect(feedback.status).toBe("FOLLOW_UP_DUE");
  });

  it("builds factual copy for a snoozed collection task", () => {
    const feedback = buildActionFeedback({
      action: "TASK_SNOOZED",
      nextDate: "2026-05-12",
      status: "TASK_SNOOZED",
      priorityBefore: 80,
      priorityAfter: 60,
    });

    expect(feedback.title).toBe("Task snoozed");
    expect(feedback.facts).toContainEqual({
      label: "Next due",
      value: "2026-05-12",
    });
    expect(feedback.facts).toContainEqual({
      label: "Priority",
      value: "80 -> 60",
    });
  });

  it("builds factual copy for a created promise to pay", () => {
    const feedback = buildActionFeedback({
      action: "PTP_CREATED",
      amount: "INR 12,500",
      nextDate: "2026-05-20",
      status: "PTP_OPEN",
    });

    expect(feedback.title).toBe("Promise to Pay logged");
    expect(feedback.facts).toContainEqual({
      label: "Promised date",
      value: "2026-05-20",
    });
    expect(feedback.facts).toContainEqual({
      label: "Amount",
      value: "INR 12,500",
    });
  });

  it("builds factual copy for a raised dispute", () => {
    const feedback = buildActionFeedback({
      action: "DISPUTE_RAISED",
      nextDate: "2026-05-18",
      reference: "AMOUNT_DISPUTED",
      status: "DISPUTE_OPEN",
    });

    expect(feedback.title).toBe("Dispute raised");
    expect(feedback.facts).toContainEqual({
      label: "Expected resolution",
      value: "2026-05-18",
    });
    expect(feedback.facts).toContainEqual({
      label: "Reference",
      value: "AMOUNT_DISPUTED",
    });
  });

  it("builds factual copy for submitted reconciliation", () => {
    const feedback = buildActionFeedback({
      action: "RECONCILIATION_SUBMITTED",
      reference: "Delta INR 0",
      status: "MATCHED",
    });

    expect(feedback.title).toBe("Reconciliation submitted");
    expect(feedback.facts).toContainEqual({
      label: "Reference",
      value: "Delta INR 0",
    });
    expect(feedback.status).toBe("MATCHED");
  });

  it("does not use praise or cash-collection reward language", () => {
    const allCopy = [
      "FOLLOW_UP_LOGGED",
      "TASK_SNOOZED",
      "PTP_CREATED",
      "DISPUTE_RAISED",
      "RECONCILIATION_SUBMITTED",
    ]
      .map((action) =>
        buildActionFeedback({
          action: action as Parameters<typeof buildActionFeedback>[0]["action"],
          nextDate: "2026-05-10",
          status: "OPEN",
          amount: "INR 1",
          reference: "INV-1",
          priorityBefore: 20,
          priorityAfter: 25,
        }),
      )
      .flatMap((feedback) => [
        feedback.title,
        feedback.message,
        ...feedback.facts.map((fact) => `${fact.label} ${fact.value}`),
      ])
      .join(" ");

    expect(allCopy).not.toMatch(BANNED_COPY);
  });
});
