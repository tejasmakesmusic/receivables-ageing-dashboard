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
