import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DISPUTES_PAGE = join(ROOT, "src", "app", "dispute-cases", "page.tsx");
const DISPUTE_KANBAN = join(
  ROOT,
  "src",
  "app",
  "dispute-cases",
  "_components",
  "dispute-kanban.tsx",
);

describe("Dispute Cases Kanban view", () => {
  it("ships a DisputeKanban client component with lifecycle columns", () => {
    expect(existsSync(DISPUTE_KANBAN)).toBe(true);

    const source = readFileSync(DISPUTE_KANBAN, "utf8");

    expect(source).toContain("\"use client\"");
    expect(source).toContain("dispute_case_status");
    expect(source).toContain("OPEN");
    expect(source).toContain("IN_REVIEW");
    expect(source).toContain("WAITING_ON_CUSTOMER");
    expect(source).toContain("RESOLVED");
    expect(source).toContain("CLOSED");
  });

  it("defines state-machine-aware drag handling through the disputes API", () => {
    const source = readFileSync(DISPUTE_KANBAN, "utf8");

    expect(source).toContain("validNextStates");
    expect(source).toContain("/api/disputes/");
    expect(source).toContain("onDragStart");
    expect(source).toContain("onDragOver");
    expect(source).toContain("onDrop");
    expect(source).toContain("Couldn't move (state machine rejected)");
  });

  it("lets searchParams.tab switch between DataTable and Kanban views", () => {
    const source = readFileSync(DISPUTES_PAGE, "utf8");

    expect(source).toContain("first(raw.tab)");
    expect(source).toContain("<DisputeKanban");
    expect(source).toMatch(/activeTab\s*===\s*"kanban"/);
    expect(source).toMatch(/activeTab\s*!==\s*"kanban"/);
    expect(source).toContain("<DataTable<");
  });
});
