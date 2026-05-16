import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

const adminRouteFiles = [
  "src/app/api/admin/xero/connect/route.ts",
  "src/app/api/admin/xero/callback/route.ts",
  "src/app/api/admin/xero/disconnect/route.ts",
];

describe("xero route guards", () => {
  it("keeps connection management ADMIN-only", () => {
    for (const file of adminRouteFiles) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).toContain("requireRole(role_enum.ADMIN");
    }
  });

  it("does not expose CFO or PENDING in Xero mutation routes", () => {
    for (const file of adminRouteFiles) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toContain("role_enum.CFO");
      expect(source).not.toContain("role_enum.PENDING");
    }
  });

  it("keeps the pull route limited to ANALYST and ADMIN", () => {
    const source = readFileSync(
      join(root, "src/app/api/xero/snapshots/pull/route.ts"),
      "utf8",
    );
    expect(source).toContain(
      "requireRole(role_enum.ANALYST, role_enum.ADMIN)",
    );
    expect(source).not.toContain("role_enum.CFO");
    expect(source).not.toContain("role_enum.PENDING");
  });
});
