import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_ROOTS = [join(ROOT, "app"), join(ROOT, "components")];

const FORBIDDEN_VISIBLE_COPY = [
  "Acme Corp.",
  "Jane Cooper",
  "Standard Follow-up",
  "Run Batch Reminder",
  "preview-only",
  "not stored yet",
  "Workflow execution is not configured",
  "Publishing waits for workflow engine",
  "Test Workflow",
  "Invite User",
  "Save Changes",
  "Configure Rules",
  "Read-only shell",
  "Permission preview",
  "not enabled in this shell",
  "Bank transaction matching is not active here",
  "automation is executed from this page yet",
  "Not Configured",
];

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const filePath = join(root, entry);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      if (filePath.includes(`${sep}__tests__${sep}`)) return [];
      return sourceFiles(filePath);
    }

    return filePath.endsWith(".ts") || filePath.endsWith(".tsx")
      ? [filePath]
      : [];
  });
}

describe("product UI copy", () => {
  it("does not expose fake personas or placeholder feature stubs", () => {
    const matches = SCAN_ROOTS.flatMap((scanRoot) =>
      sourceFiles(scanRoot).flatMap((filePath) => {
        const source = readFileSync(filePath, "utf8");

        return FORBIDDEN_VISIBLE_COPY.filter((phrase) =>
          source.includes(phrase),
        ).map((phrase) => `${filePath.replace(`${ROOT}${sep}`, "")}: ${phrase}`);
      }),
    );

    expect(matches).toEqual([]);
  });
});
