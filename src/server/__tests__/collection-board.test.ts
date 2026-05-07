import { describe, expect, it } from "vitest";
import { groupCollectionBoard } from "@/server/collection-tasks/board";

describe("collection board grouping", () => {
  it("places tasks into launch board columns", () => {
    const board = groupCollectionBoard([
      {
        id: "1",
        priority_score: 91,
        reason_code: "NINETY_PLUS",
        status: "SUGGESTED",
      },
      {
        id: "2",
        priority_score: 70,
        reason_code: "STALE_FOLLOW_UP",
        status: "OPEN",
      },
      {
        id: "3",
        priority_score: 95,
        reason_code: "BROKEN_PROMISE",
        status: "IN_PROGRESS",
      },
      {
        id: "4",
        priority_score: 75,
        reason_code: "HIGH_VALUE",
        status: "SNOOZED",
      },
      {
        id: "5",
        priority_score: 20,
        reason_code: "MANUAL",
        status: "DONE",
      },
    ]);

    expect(
      board.map((column) => [
        column.id,
        column.tasks.map((task) => task.id),
      ]),
    ).toEqual([
      ["new", ["1", "2"]],
      ["reminder-sent", []],
      ["promise-to-pay", ["3"]],
      ["escalated", []],
      ["payment-expected", ["4"]],
      ["closed", ["5"]],
    ]);
  });
});
