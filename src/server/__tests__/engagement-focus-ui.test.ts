import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const GOAL_CHIP = join(
  ROOT,
  "src",
  "components",
  "engagement",
  "goal-chip.tsx",
);
const ONBOARDING_CHECKLIST = join(
  ROOT,
  "src",
  "components",
  "engagement",
  "onboarding-checklist.tsx",
);
const STREAK_BADGE = join(
  ROOT,
  "src",
  "components",
  "engagement",
  "streak-badge.tsx",
);
const FOCUS_PAGE = join(ROOT, "src", "app", "focus", "page.tsx");

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("engagement Focus UI", () => {
  it("ships a GoalChip with progressbar semantics and target/completed props", () => {
    expect(existsSync(GOAL_CHIP)).toBe(true);

    const chip = source(GOAL_CHIP);

    expect(chip).toContain("Today's focus");
    expect(chip).toContain('role="progressbar"');
    expect(chip).toContain("target");
    expect(chip).toContain("completed");
    expect(chip).toContain("aria-valuenow");
    expect(chip).toContain("aria-valuemax");
  });

  it("ships a persisted progressive onboarding checklist with all first-run steps", () => {
    expect(existsSync(ONBOARDING_CHECKLIST)).toBe(true);

    const checklist = source(ONBOARDING_CHECKLIST);

    expect(checklist).toContain("Upload your first AR snapshot");
    expect(checklist).toContain("Resolve any staging warnings");
    expect(checklist).toContain("Work a collection task");
    expect(checklist).toContain("Log a follow-up");
    expect(checklist).toContain("Record a promise to pay");
    expect(checklist).toContain("Raise a dispute (if applicable)");
    expect(checklist).toContain("Review the ageing export");
    expect(checklist).toContain("receivables_onboarding_dismissed_v1");
  });

  it("ships a StreakBadge that fetches streak state and handles a missing endpoint", () => {
    expect(existsSync(STREAK_BADGE)).toBe(true);

    const badge = source(STREAK_BADGE);

    expect(badge).toContain("/api/engagement/streak");
    expect(badge).toMatch(/status\s*={2,3}\s*404|404/);
    expect(badge).toContain("Flame");
  });

  it("mounts engagement components on the Focus page", () => {
    const page = source(FOCUS_PAGE);

    expect(page).toContain("<GoalChip");
    expect(page).toContain("<OnboardingChecklist");
    expect(page).toContain("<StreakBadge");
  });

  it("shows Focus Queue progress chips for operating state", () => {
    const page = source(FOCUS_PAGE);

    expect(page).toContain("data-focus-progress-chip");
    expect(page).toContain("Due now");
    expect(page).toContain("High priority");
    expect(page).toContain("Blockers");
    expect(page).toContain("Completed today");
  });

  it("keeps engagement copy free of celebratory or cash-collected language", () => {
    const combined = [
      source(FOCUS_PAGE),
      existsSync(GOAL_CHIP) ? source(GOAL_CHIP) : "",
      existsSync(ONBOARDING_CHECKLIST) ? source(ONBOARDING_CHECKLIST) : "",
      existsSync(STREAK_BADGE) ? source(STREAK_BADGE) : "",
    ].join("\n");

    expect(combined).not.toMatch(/confetti|🎉|amazing|you crushed|💸/i);
  });
});
