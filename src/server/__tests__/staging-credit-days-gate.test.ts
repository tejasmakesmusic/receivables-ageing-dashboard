import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = join(
  process.cwd(),
  "src",
  "server",
  "snapshots",
  "service.ts",
);

describe("staging credit_days_missing gate", () => {
  it("StagingInvoiceRow has no_credit_days field", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain("no_credit_days: boolean");
  });

  it("PublishGate has credit_days_missing_count field", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain(
      "credit_days_missing_count: number",
    );
  });

  it("gate ok predicate includes creditDaysMissing === 0", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain(
      "creditDaysMissing === 0",
    );
  });

  it("filter schema includes no_credit_days variant", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain('"no_credit_days"');
  });

  it("calls canResolveCreditDays", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain("canResolveCreditDays");
  });
});
