import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const expectedFiles = [
  "instrumentation.ts",
  "src/lib/sentry.ts",
  "src/lib/rate-limit.ts",
  "src/middleware.ts",
  "src/lib/upload-validation.ts",
  "src/app/api/snapshots/upload/route.ts",
  "src/app/error.tsx",
  "src/app/global-error.tsx",
  "docs/owasp-review.md",
];

describe("production hardening files", () => {
  it.each(expectedFiles)("%s exists", (filePath) => {
    expect(existsSync(join(process.cwd(), filePath))).toBe(true);
  });
});
