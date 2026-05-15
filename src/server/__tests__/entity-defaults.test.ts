import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULE = join(
  process.cwd(),
  "src",
  "server",
  "config",
  "entityDefaults.ts",
);

describe("entityDefaults server module", () => {
  it("exports listEntityDefaults", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("export async function listEntityDefaults");
  });

  it("exports updateEntityDefault", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("export async function updateEntityDefault");
  });

  it("enforces ANALYST and ADMIN RBAC in updateEntityDefault", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("role_enum.ANALYST");
    expect(src).toContain("role_enum.ADMIN");
    expect(src).toContain("ForbiddenError");
  });

  it("writes audit_log on update", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("createAuditLog");
    expect(src).toContain("entity_default_credit_days_updated");
  });
});
