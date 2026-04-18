import { describe, it, expect } from "vitest";
import { formatINR, formatAED, formatISTDate, formatPct, formatCurrency } from "@/lib/format";

describe("formatINR", () => {
  it("formats whole number in INR", () => {
    const s = formatINR(1000000);
    expect(s).toContain("10"); // ₹10,00,000
    expect(s).toContain("00");
  });

  it("handles string input", () => {
    expect(formatINR("500000")).toContain("5");
  });

  it("returns — for NaN", () => {
    expect(formatINR("not-a-number")).toBe("—");
  });
});

describe("formatAED", () => {
  it("formats AED amount", () => {
    const s = formatAED(1234.56);
    expect(s).toContain("1,234");
  });

  it("returns — for NaN", () => {
    expect(formatAED("bad")).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("dispatches to INR for INR", () => {
    const s = formatCurrency(1000, "INR");
    expect(s).toContain("1,000");
  });

  it("dispatches to AED for AED", () => {
    const s = formatCurrency(1000, "AED");
    expect(s).toContain("1,000");
  });
});

describe("formatISTDate", () => {
  it("returns — for empty string", () => {
    expect(formatISTDate("")).toBe("—");
  });

  it("formats a valid ISO date", () => {
    const s = formatISTDate("2025-04-18T00:00:00Z");
    // en-IN format, just check year is present
    expect(s).toContain("2025");
  });
});

describe("formatPct", () => {
  it("formats number to one decimal", () => {
    expect(formatPct(12.345)).toBe("12.3%");
  });

  it("handles string", () => {
    expect(formatPct("50")).toBe("50.0%");
  });

  it("returns — for NaN", () => {
    expect(formatPct("bad")).toBe("—");
  });
});
