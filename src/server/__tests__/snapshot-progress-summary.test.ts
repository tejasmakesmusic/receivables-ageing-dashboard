import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeSnapshotProgressParse } from "@/server/snapshots/progress-summary";

const SNAPSHOT_PAGE = join(
  process.cwd(),
  "src",
  "app",
  "snapshots",
  "[snapshotId]",
  "page.tsx",
);

describe("snapshot progress summary", () => {
  it("excludes acknowledged warnings and dismissed parse errors from open blockers", () => {
    const summary = summarizeSnapshotProgressParse({
      parseResult: {
        invoices: [
          { row_index: 2, status: "OK" },
          { row_index: 3, status: "PARSE_ERROR" },
          { row_index: 4, status: "PARSE_ERROR" },
          { row_index: 5, status: "PARSE_ERROR" },
        ],
        credit_periods: [{ row_index: 7 }],
        warnings: [
          { code: "HEADER_DRIFT" },
          { code: "EXTRA_COLUMN" },
          { code: "MISSING_OPTIONAL" },
        ],
        errors: [{ code: "FILE_LEVEL" }],
      },
      stagingOverrides: [
        { row_index: 3, dismissed: true },
        { row_index: 4, dismissed: true },
      ],
      warningsAcknowledged: ["HEADER_DRIFT", { code: "EXTRA_COLUMN" }],
    });

    expect(summary).toMatchObject({
      totalRows: 5,
      okRows: 2,
      parseErrorRows: 1,
      warningCount: 1,
      fileErrorCount: 1,
    });
  });

  it("wires the snapshot detail page to acknowledgement and override state", () => {
    const source = readFileSync(SNAPSHOT_PAGE, "utf8");

    expect(source).toContain("warnings_acknowledged_json");
    expect(source).toContain("staging_overrides_json");
    expect(source).toContain("summarizeSnapshotProgressParse");
  });
});
