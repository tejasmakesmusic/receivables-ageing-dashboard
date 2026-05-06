import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CI workflow", () => {
  it("exposes Prisma migrate status as the checked-in npm gate", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["prisma:migrate:status"]).toBe(
      "prisma migrate status",
    );
  });

  it("runs the Prisma migration-status gate through npm with the direct database URL", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("- run: npm run prisma:migrate:status");
    expect(workflow).toContain(
      "DATABASE_URL: ${{ secrets.NEON_DATABASE_URL_DIRECT }}",
    );
    expect(workflow).not.toContain("- run: npx prisma migrate status");
  });
});
