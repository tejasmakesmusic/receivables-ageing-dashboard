import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOTS = [
  join(process.cwd(), "src", "app"),
  join(process.cwd(), "src", "components"),
];

const API_NAVIGATION_PATTERN = /\b(?:action|formAction|href)=\{?["'`]\/api/;

function tsxFilesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      return tsxFilesIn(path);
    }

    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("UI navigation", () => {
  it("does not send users directly to JSON API routes", () => {
    const offenders = SOURCE_ROOTS.flatMap(tsxFilesIn).flatMap((file) => {
      const source = readFileSync(file, "utf8");

      return source
        .split(/\r?\n/)
        .flatMap((line, index) =>
          API_NAVIGATION_PATTERN.test(line)
            ? [
                `${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`,
              ]
            : [],
        );
    });

    expect(offenders).toEqual([]);
  });
});
