import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PTP_CALENDAR = join(
  ROOT,
  "src",
  "app",
  "promises-to-pay",
  "_components",
  "ptp-calendar.tsx",
);
const PROMISES_PAGE = join(ROOT, "src", "app", "promises-to-pay", "page.tsx");

describe("Promises to Pay calendar UI", () => {
  it("ships a PtpCalendar component with calendar sections", () => {
    expect(existsSync(PTP_CALENDAR)).toBe(true);

    const source = readFileSync(PTP_CALENDAR, "utf8");

    expect(source).toMatch(/Overdue/i);
    expect(source).toMatch(/Due Today/i);
    expect(source).toMatch(/Upcoming/i);
  });

  it("routes tab=calendar to PtpCalendar while keeping DataTable as the list view", () => {
    const source = readFileSync(PROMISES_PAGE, "utf8");

    expect(source).toMatch(/first\(raw\.tab\)/);
    expect(source).toMatch(/activeTab\s*===\s*"calendar"/);
    expect(source).toContain("<PtpCalendar");
    expect(source).toMatch(/activeTab\s*===\s*"list"/);
    expect(source).toContain("<DataTable");
  });
});
