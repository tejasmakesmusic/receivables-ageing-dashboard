import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";

const PROGRESS_PATH = join(
  process.cwd(),
  "src",
  "components",
  "engagement",
  "progress-path.tsx",
);
const NUDGE_CARD = join(
  process.cwd(),
  "src",
  "components",
  "engagement",
  "nudge-card.tsx",
);
const NUDGE_STACK = join(
  process.cwd(),
  "src",
  "components",
  "engagement",
  "nudge-stack.tsx",
);
const NUDGES_SERVICE = join(
  process.cwd(),
  "src",
  "server",
  "engagement",
  "nudges.ts",
);
const SNAPSHOT_PAGE = join(
  process.cwd(),
  "src",
  "app",
  "snapshots",
  "[snapshotId]",
  "page.tsx",
);
const FOCUS_PAGE = join(process.cwd(), "src", "app", "focus", "page.tsx");

const NEW_FILES = [PROGRESS_PATH, NUDGE_CARD, NUDGE_STACK, NUDGES_SERVICE];

const prismaMock = vi.hoisted(() => ({
  promises_to_pay: { count: vi.fn() },
  follow_ups: { findMany: vi.fn() },
  digest_events: { count: vi.fn() },
  reconciliation_entries: { count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: vi.fn(() => prismaMock),
}));

function makeUser(role: role_enum): AuthenticatedUser {
  return {
    id: `${role.toLowerCase()}-id`,
    email: `${role.toLowerCase()}@emb.global`,
    name: role,
    role,
    entityIdScope: role === role_enum.ANALYST ? "entity-ind" : null,
    isActive: true,
    lastLoginAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.promises_to_pay.count.mockResolvedValue(1);
  prismaMock.follow_ups.findMany.mockResolvedValue([
    { canonical_id: "canonical-1" },
  ]);
  prismaMock.digest_events.count.mockResolvedValue(1);
  prismaMock.reconciliation_entries.count.mockResolvedValue(1);
});

describe("engagement progress and nudges", () => {
  it("progress-path.tsx contains all six step ids and the Progress label", () => {
    const source = readFileSync(PROGRESS_PATH, "utf8");

    for (const step of [
      "upload",
      "parse",
      "review",
      "resolve",
      "publish",
      "reconcile",
    ]) {
      expect(source).toContain(step);
    }
    expect(source).toContain('aria-label="Progress"');
  });

  it("nudge-card.tsx references the required snooze options", () => {
    const source = readFileSync(NUDGE_CARD, "utf8");

    expect(source).toContain("1h");
    expect(source).toContain("4h");
    expect(source).toContain("Tomorrow");
  });

  it("nudge-stack.tsx fetches nudges and checks localStorage snoozes", () => {
    const source = readFileSync(NUDGE_STACK, "utf8");

    expect(source).toContain("/api/engagement/nudges");
    expect(source).toContain("localStorage");
  });

  it("buildNudges respects analyst and admin nudge scope", async () => {
    const { buildNudges } = await import("@/server/engagement/nudges");

    const analystNudges = await buildNudges(makeUser(role_enum.ANALYST));
    const adminNudges = await buildNudges(makeUser(role_enum.ADMIN));

    expect(analystNudges.map((nudge) => nudge.kind)).not.toContain(
      "digest_pending",
    );
    expect(analystNudges.map((nudge) => nudge.kind)).not.toContain(
      "reconciliation_unmatched",
    );
    expect(adminNudges.map((nudge) => nudge.kind)).toEqual(
      expect.arrayContaining([
        "ptp_due",
        "stale_followup",
        "digest_pending",
        "reconciliation_unmatched",
      ]),
    );
  });

  it("snapshot detail page mounts ProgressPath", () => {
    const source = readFileSync(SNAPSHOT_PAGE, "utf8");

    expect(source).toContain("ProgressPath");
  });

  it("focus page mounts NudgeStack", () => {
    const source = readFileSync(FOCUS_PAGE, "utf8");

    expect(source).toContain("NudgeStack");
  });

  it("keeps the new engagement files free of denied copy", () => {
    for (const file of NEW_FILES) {
      expect(existsSync(file)).toBe(true);
      const source = readFileSync(file, "utf8");

      expect(source).not.toContain("🎉");
      expect(source).not.toMatch(/\bamazing\b/i);
      expect(source).not.toMatch(/\bcrushed\b/i);
    }
  });
});
