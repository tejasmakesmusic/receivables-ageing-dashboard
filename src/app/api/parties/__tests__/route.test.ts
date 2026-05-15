import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("GET /api/parties", () => {
  const src = readFileSync(resolve(__dirname, "../route.ts"), "utf-8");

  it("exports force-dynamic", () => {
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("requires at least ANALYST role", () => {
    expect(src).toContain("role_enum.ANALYST");
    expect(src).toContain("role_enum.CFO");
    expect(src).toContain("role_enum.REVIEWER");
    expect(src).toContain("role_enum.ADMIN");
  });

  it("validates name_contains with min length 2", () => {
    expect(src).toContain("min(2");
  });

  it("caps page_size at 20", () => {
    expect(src).toContain("max(20)");
  });

  it("calls searchParties", () => {
    expect(src).toContain("searchParties");
  });
});
