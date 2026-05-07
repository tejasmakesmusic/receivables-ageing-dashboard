import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const REQUIRED_FILES = [
  ".storybook/main.ts",
  ".storybook/preview.ts",
  ".storybook/preview.css",
  "src/components/ui/data-table.stories.tsx",
  "src/components/ui/side-panel.stories.tsx",
  "src/components/ui/status-tag.stories.tsx",
  "src/components/ui/button.stories.tsx",
  "src/components/shell/Sidebar.stories.tsx",
  "src/components/engagement/goal-chip.stories.tsx",
  "src/components/engagement/progress-path.stories.tsx",
  "src/components/engagement/nudge-card.stories.tsx",
  "src/components/engagement/streak-badge.stories.tsx",
  "src/components/saved-views/saved-view-switcher.stories.tsx",
  "docs/a11y-checklist.md",
] as const;

describe("Storybook handoff coverage", () => {
  it.each(REQUIRED_FILES)("%s exists", (relativePath) => {
    expect(existsSync(join(ROOT, relativePath))).toBe(true);
  });
});
