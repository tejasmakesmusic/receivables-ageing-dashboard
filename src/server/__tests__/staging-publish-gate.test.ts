import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SNAPSHOT_SERVICE = join(
  process.cwd(),
  "src",
  "server",
  "snapshots",
  "service.ts",
);

describe("staging publish gate", () => {
  it("blocks unresolved fuzzy-low and fuzzy-high alias matches", () => {
    const source = readFileSync(SNAPSHOT_SERVICE, "utf8");

    expect(source).toContain("fuzzy_low_pending_count");
    expect(source).toContain('row.alias_resolution.resolutionState === "FUZZY_LOW"');
    expect(source).toContain('row.alias_resolution.resolutionState === "FUZZY_HIGH"');
  });
});
