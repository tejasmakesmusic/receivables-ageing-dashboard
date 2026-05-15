import { describe, expect, it } from "vitest";
import { canResolveCreditDays } from "@/server/ageing/credit-days-check";

const CONFIG_OPEN = {
  canonical_id: "aaa",
  valid_from: new Date("2025-01-01"),
  valid_to: null,
};

const CONFIG_CLOSED = {
  canonical_id: "aaa",
  valid_from: new Date("2025-01-01"),
  valid_to: new Date("2025-06-30"),
};

describe("canResolveCreditDays", () => {
  it("returns true when credit_days_override is set", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: 30,
        entityDefaultDays: null,
        configs: [],
      }),
    ).toBe(true);
  });

  it("returns true when a matching open config exists", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_OPEN],
      }),
    ).toBe(true);
  });

  it("returns true when a matching closed config covers the invoice date", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2025-03-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_CLOSED],
      }),
    ).toBe(true);
  });

  it("returns false when closed config does not cover the invoice date", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2025-07-01"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_CLOSED],
      }),
    ).toBe(false);
  });

  it("returns true when no config but entityDefaultDays is set", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: 30,
        configs: [],
      }),
    ).toBe(true);
  });

  it("returns false when no config, no default, no override", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [],
      }),
    ).toBe(false);
  });

  it("ignores configs for a different canonical_id", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "bbb",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_OPEN],
      }),
    ).toBe(false);
  });
});
