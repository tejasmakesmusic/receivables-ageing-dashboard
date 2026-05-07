import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SIDEBAR_SOURCE = readFileSync(
  join(process.cwd(), "src", "components", "shell", "Sidebar.tsx"),
  "utf8",
);

const EXPECTED_NAV_ITEMS = [
  { href: "/", icon: "Home", label: "Home" },
  { href: "/dashboard", icon: "PieChart", label: "Dashboard" },
  { href: "/focus", icon: "Target", label: "Focus Queue" },
  { href: "/snapshots", icon: "Layers", label: "Snapshots" },
  { href: "/invoices", icon: "FileText", label: "Invoices" },
  { href: "/parties", icon: "Building2", label: "Parties" },
  { href: "/tasks", icon: "Inbox", label: "Tasks" },
  { href: "/promises-to-pay", icon: "(?:HandCoins|CalendarClock)", label: "Promises" },
  { href: "/dispute-cases", icon: "AlertTriangle", label: "Disputes" },
  { href: "/reconciliation", icon: "RefreshCw", label: "Reconciliation" },
  { href: "/workflows", icon: "SlidersHorizontal", label: "Workflows" },
  { href: "/reports", icon: "BarChart3", label: "Reports" },
  { href: "/admin", icon: "Settings", label: "Admin" },
] as const;

function navItemPattern({
  href,
  icon,
  label,
}: (typeof EXPECTED_NAV_ITEMS)[number]) {
  return String.raw`\{\s*href:\s*"${href.replace("/", "\\/")}",\s*label:\s*"${label}",\s*icon:\s*${icon}\s*\}`;
}

describe("sidebar navigation", () => {
  it("exposes the PRD navigation items in canonical order", () => {
    const navBlock = SIDEBAR_SOURCE.match(
      /const NAV_ITEMS = \[(?<items>[\s\S]*?)\] as const;/,
    )?.groups?.items;

    expect(navBlock).toBeDefined();
    expect(navBlock?.match(/\{\s*href:/g)?.length).toBe(13);
    expect(navBlock).toMatch(
      new RegExp(EXPECTED_NAV_ITEMS.map(navItemPattern).join(String.raw`[\s\S]*`)),
    );
  });
});
