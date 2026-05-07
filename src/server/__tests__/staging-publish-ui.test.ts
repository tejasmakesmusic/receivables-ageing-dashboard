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
const PUBLISH_PANEL = join(
  process.cwd(),
  "src",
  "app",
  "snapshots",
  "[snapshotId]",
  "staging",
  "_components",
  "staging-publish-panel.tsx",
);

describe("staging publish UI", () => {
  it("surfaces the publish workflow on the staging page", () => {
    const pageSource = readFileSync(STAGING_PAGE, "utf8");

    expect(pageSource).toContain("StagingPublishPanel");
    expect(pageSource).toContain("publishGate={staging.publish_gate}");
  });

  it("lets analysts acknowledge warnings and publish without API navigation", () => {
    expect(existsSync(PUBLISH_PANEL)).toBe(true);

    const panelSource = readFileSync(PUBLISH_PANEL, "utf8");

    expect(panelSource).toContain("/warnings/ack");
    expect(panelSource).toContain("/publish");
    expect(panelSource).toContain("router.push(`/snapshots/${snapshotId}`)");
    expect(panelSource).not.toContain('action="/api');
    expect(panelSource).not.toContain('href="/api');
  });
});
