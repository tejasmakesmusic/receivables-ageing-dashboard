import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STAGING_PAGE = join(
  process.cwd(),
  "src",
  "app",
  "snapshots",
  "[snapshotId]",
  "staging",
  "page.tsx",
);
const ROW_ACTIONS = join(
  process.cwd(),
  "src",
  "app",
  "snapshots",
  "[snapshotId]",
  "staging",
  "_components",
  "staging-row-actions.tsx",
);

describe("staging row actions UI", () => {
  it("renders row-level resolution actions on the staging grid", () => {
    const pageSource = readFileSync(STAGING_PAGE, "utf8");

    expect(pageSource).toContain("StagingRowActions");
    expect(pageSource).toContain("snapshotId={snapshotId}");
  });

  it("supports alias resolution, canonical creation, and parse-error review", () => {
    expect(existsSync(ROW_ACTIONS)).toBe(true);

    const source = readFileSync(ROW_ACTIONS, "utf8");

    expect(source).toContain("resolve_alias");
    expect(source).toContain("create_canonical");
    expect(source).toContain("dismiss_parse_error");
    expect(source).toContain("router.refresh()");
    expect(source).not.toContain('action="/api');
    expect(source).not.toContain('href="/api');
  });
});
