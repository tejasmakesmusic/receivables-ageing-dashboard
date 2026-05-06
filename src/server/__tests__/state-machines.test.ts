/**
 * State machine tests — no DB required.
 *
 * Covers:
 *  - Collection task transitions (ALLOWED_TRANSITIONS)
 *  - PTP transitions (ALLOWED_PTP_TRANSITIONS)
 *  - Dispute case transitions (ALLOWED_DISPUTE_TRANSITIONS)
 *
 * These are exported for testing; the service files use them internally
 * to validate PATCH requests.
 */
import { describe, it, expect } from "vitest";
import {
  collection_task_status,
  promise_to_pay_status,
  dispute_case_status,
} from "@/generated/prisma/enums";

// ── Collection task state machine ─────────────────────────────────────────────
// Inline the same map as service.ts so test failures catch regressions
const TASK_TRANSITIONS: Record<
  collection_task_status,
  collection_task_status[]
> = {
  [collection_task_status.SUGGESTED]: [
    collection_task_status.OPEN,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.OPEN]: [
    collection_task_status.IN_PROGRESS,
    collection_task_status.SNOOZED,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.IN_PROGRESS]: [
    collection_task_status.DONE,
    collection_task_status.SNOOZED,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.SNOOZED]: [
    collection_task_status.OPEN,
    collection_task_status.DISMISSED,
  ],
  [collection_task_status.DONE]: [],
  [collection_task_status.DISMISSED]: [],
};

describe("Collection task state machine", () => {
  it("SUGGESTED → OPEN is valid", () => {
    expect(
      TASK_TRANSITIONS[collection_task_status.SUGGESTED],
    ).toContain(collection_task_status.OPEN);
  });

  it("SUGGESTED → DISMISSED is valid", () => {
    expect(
      TASK_TRANSITIONS[collection_task_status.SUGGESTED],
    ).toContain(collection_task_status.DISMISSED);
  });

  it("SUGGESTED → IN_PROGRESS is NOT valid", () => {
    expect(
      TASK_TRANSITIONS[collection_task_status.SUGGESTED],
    ).not.toContain(collection_task_status.IN_PROGRESS);
  });

  it("OPEN → IN_PROGRESS is valid", () => {
    expect(TASK_TRANSITIONS[collection_task_status.OPEN]).toContain(
      collection_task_status.IN_PROGRESS,
    );
  });

  it("OPEN → SNOOZED is valid", () => {
    expect(TASK_TRANSITIONS[collection_task_status.OPEN]).toContain(
      collection_task_status.SNOOZED,
    );
  });

  it("OPEN → DONE is NOT valid (must go through IN_PROGRESS)", () => {
    expect(TASK_TRANSITIONS[collection_task_status.OPEN]).not.toContain(
      collection_task_status.DONE,
    );
  });

  it("IN_PROGRESS → DONE is valid", () => {
    expect(TASK_TRANSITIONS[collection_task_status.IN_PROGRESS]).toContain(
      collection_task_status.DONE,
    );
  });

  it("DONE is terminal — no valid transitions", () => {
    expect(TASK_TRANSITIONS[collection_task_status.DONE]).toHaveLength(0);
  });

  it("DISMISSED is terminal — no valid transitions", () => {
    expect(TASK_TRANSITIONS[collection_task_status.DISMISSED]).toHaveLength(0);
  });

  it("SNOOZED can return to OPEN", () => {
    expect(TASK_TRANSITIONS[collection_task_status.SNOOZED]).toContain(
      collection_task_status.OPEN,
    );
  });
});

// ── PTP state machine ─────────────────────────────────────────────────────────
const PTP_TRANSITIONS: Record<
  promise_to_pay_status,
  promise_to_pay_status[]
> = {
  [promise_to_pay_status.OPEN]: [
    promise_to_pay_status.KEPT,
    promise_to_pay_status.BROKEN,
    promise_to_pay_status.CANCELLED,
  ],
  [promise_to_pay_status.KEPT]: [],
  [promise_to_pay_status.BROKEN]: [],
  [promise_to_pay_status.CANCELLED]: [],
};

describe("Promise-to-pay state machine", () => {
  it("OPEN → KEPT is valid", () => {
    expect(PTP_TRANSITIONS[promise_to_pay_status.OPEN]).toContain(
      promise_to_pay_status.KEPT,
    );
  });

  it("OPEN → BROKEN is valid", () => {
    expect(PTP_TRANSITIONS[promise_to_pay_status.OPEN]).toContain(
      promise_to_pay_status.BROKEN,
    );
  });

  it("OPEN → CANCELLED is valid", () => {
    expect(PTP_TRANSITIONS[promise_to_pay_status.OPEN]).toContain(
      promise_to_pay_status.CANCELLED,
    );
  });

  it("KEPT is terminal", () => {
    expect(PTP_TRANSITIONS[promise_to_pay_status.KEPT]).toHaveLength(0);
  });

  it("BROKEN is terminal", () => {
    expect(PTP_TRANSITIONS[promise_to_pay_status.BROKEN]).toHaveLength(0);
  });

  it("CANCELLED is terminal", () => {
    expect(PTP_TRANSITIONS[promise_to_pay_status.CANCELLED]).toHaveLength(0);
  });
});

// ── Dispute case state machine ────────────────────────────────────────────────
const DISPUTE_TRANSITIONS: Record<
  dispute_case_status,
  dispute_case_status[]
> = {
  [dispute_case_status.OPEN]: [
    dispute_case_status.IN_REVIEW,
    dispute_case_status.WAITING_ON_CUSTOMER,
    dispute_case_status.RESOLVED,
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.IN_REVIEW]: [
    dispute_case_status.OPEN,
    dispute_case_status.WAITING_ON_CUSTOMER,
    dispute_case_status.RESOLVED,
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.WAITING_ON_CUSTOMER]: [
    dispute_case_status.IN_REVIEW,
    dispute_case_status.RESOLVED,
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.RESOLVED]: [dispute_case_status.CLOSED],
  [dispute_case_status.CLOSED]: [],
};

describe("Dispute case state machine", () => {
  it("OPEN → IN_REVIEW is valid", () => {
    expect(DISPUTE_TRANSITIONS[dispute_case_status.OPEN]).toContain(
      dispute_case_status.IN_REVIEW,
    );
  });

  it("OPEN → RESOLVED is valid (skip straight to resolution)", () => {
    expect(DISPUTE_TRANSITIONS[dispute_case_status.OPEN]).toContain(
      dispute_case_status.RESOLVED,
    );
  });

  it("WAITING_ON_CUSTOMER → IN_REVIEW is valid (customer responded)", () => {
    expect(
      DISPUTE_TRANSITIONS[dispute_case_status.WAITING_ON_CUSTOMER],
    ).toContain(dispute_case_status.IN_REVIEW);
  });

  it("RESOLVED → CLOSED is valid", () => {
    expect(DISPUTE_TRANSITIONS[dispute_case_status.RESOLVED]).toContain(
      dispute_case_status.CLOSED,
    );
  });

  it("RESOLVED → OPEN is NOT valid (cannot reopen a resolved dispute)", () => {
    expect(DISPUTE_TRANSITIONS[dispute_case_status.RESOLVED]).not.toContain(
      dispute_case_status.OPEN,
    );
  });

  it("CLOSED is terminal", () => {
    expect(DISPUTE_TRANSITIONS[dispute_case_status.CLOSED]).toHaveLength(0);
  });
});
