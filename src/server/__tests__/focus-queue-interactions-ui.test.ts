import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FOCUS_QUEUE_TABLE = join(
  ROOT,
  "src",
  "app",
  "focus",
  "_components",
  "focus-queue-table.tsx",
);
const FOCUS_PAGE = join(ROOT, "src", "app", "focus", "page.tsx");

describe("Focus Queue interactions", () => {
  it("uses a client row table for keyboard navigation", () => {
    expect(existsSync(FOCUS_QUEUE_TABLE)).toBe(true);

    const source = readFileSync(FOCUS_QUEUE_TABLE, "utf8");

    expect(source).toContain('"use client"');
    expect(source).toContain("getKeyboardCommand");
    expect(source).toContain("getNextRovingIndex");
    expect(source).toContain("router.push(items[activeIndex].href)");
    expect(source).toContain("tabIndex={index === activeIndex ? 0 : -1}");
  });

  it("exposes a stable row action rail for opening context", () => {
    const source = readFileSync(FOCUS_QUEUE_TABLE, "utf8");

    // The action rail used to fade in on hover/focus; current design keeps
    // it persistently visible so keyboard users don't need a hover state to
    // discover it. Assert the open-context affordance is present and a11y-labelled.
    expect(source).toContain('data-focus-queue-action="open-context"');
    expect(source).toContain("ExternalLink");
    expect(source).toContain('title="Open context"');
    expect(source).toContain('aria-label={`Open ${item.title}`}');
  });

  it("exposes route-backed action hints for queue item types", () => {
    const source = readFileSync(FOCUS_QUEUE_TABLE, "utf8");

    expect(source).toContain("function actionHint");
    expect(source).toContain('"Claim"');
    expect(source).toContain('"Promise"');
    expect(source).toContain('"Escalate"');
    expect(source).toContain('"Resolve"');
    expect(source).toContain('"Tie-out"');
    expect(source).toContain("data-focus-queue-action={hint.label.toLowerCase()}");
  });

  it("keeps Focus page server-rendered and delegates only row behavior", () => {
    const source = readFileSync(FOCUS_PAGE, "utf8");

    expect(source).toContain("getFocusQueue");
    expect(source).toContain("<FocusQueueTable items={queue.items} />");
  });
});
