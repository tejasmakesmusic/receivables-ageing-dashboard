import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { role_enum } from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";

const prismaMock = vi.hoisted(() => ({
  fx_rates: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

const auditMock = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: vi.fn(() => prismaMock),
}));

vi.mock("@/server/core/audit", () => ({
  createAuditLog: auditMock.createAuditLog,
}));

function adminUser(): AuthenticatedUser {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    email: "admin@emb.global",
    name: "Admin",
    role: role_enum.ADMIN,
    entityIdScope: null,
    isActive: true,
    lastLoginAt: null,
  };
}

describe("ExchangeRate-API FX importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXCHANGERATE_API_KEY = "test-api-key";
  });

  it("fetches a historical AED to INR rate for the requested invoice date", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: "success",
        base_code: "AED",
        year: 2025,
        month: 6,
        day: 16,
        conversion_rates: { INR: 23.412345 },
      }),
    });
    const { fetchExchangeRateApiHistoricalRate } = await import(
      "@/server/config/fxRateImport"
    );

    const result = await fetchExchangeRateApiHistoricalRate({
      apiKey: "test-api-key",
      fromCcy: "AED",
      toCcy: "INR",
      date: "2025-06-16",
      fetchFn: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://v6.exchangerate-api.com/v6/test-api-key/history/AED/2025/6/16",
      { cache: "no-store" },
    );
    expect(result).toEqual({
      date: "2025-06-16",
      from_ccy: "AED",
      to_ccy: "INR",
      rate: 23.412345,
      provider: "EXCHANGERATE_API",
    });
  });

  it("turns provider errors into sanitized application errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: "error",
        "error-type": "plan-upgrade-required",
      }),
    });
    const { fetchExchangeRateApiHistoricalRate } = await import(
      "@/server/config/fxRateImport"
    );

    await expect(
      fetchExchangeRateApiHistoricalRate({
        apiKey: "secret-that-must-not-leak",
        fromCcy: "AED",
        toCcy: "INR",
        date: "2025-06-16",
        fetchFn: fetchMock,
      }),
    ).rejects.toMatchObject({
      code: "fx_rate_provider_error",
      message:
        "ExchangeRate-API could not return AED->INR for 2025-06-16: plan-upgrade-required",
    });
  });

  it("imports an API-sourced immutable FX row and writes audit", async () => {
    prismaMock.fx_rates.findFirst.mockResolvedValue(null);
    prismaMock.fx_rates.create.mockResolvedValue({
      id: "22222222-2222-2222-2222-222222222222",
      from_ccy: "AED",
      to_ccy: "INR",
      rate: { toString: () => "23.412345" },
      effective_from: new Date("2025-06-16T00:00:00.000Z"),
      source: "API",
      created_at: new Date("2026-05-16T00:00:00.000Z"),
      users: { email: "admin@emb.global" },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        result: "success",
        base_code: "AED",
        conversion_rates: { INR: 23.412345 },
      }),
    });
    const { importExchangeRateApiFxRate } = await import(
      "@/server/config/fxRateImport"
    );

    const result = await importExchangeRateApiFxRate(
      { from_ccy: "AED", to_ccy: "INR", date: "2025-06-16" },
      adminUser(),
      { fetchFn: fetchMock },
    );

    expect(prismaMock.fx_rates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from_ccy: "AED",
          to_ccy: "INR",
          effective_from: new Date("2025-06-16T00:00:00.000Z"),
          source: "API",
          created_by: "11111111-1111-1111-1111-111111111111",
        }),
      }),
    );
    expect(auditMock.createAuditLog).toHaveBeenCalledWith(
      "11111111-1111-1111-1111-111111111111",
      "fx_rate.import",
      "fx_rates",
      "22222222-2222-2222-2222-222222222222",
      {},
      expect.objectContaining({
        from_ccy: "AED",
        to_ccy: "INR",
        rate: "23.412345",
        effective_from: "2025-06-16",
        source: "API",
        provider: "EXCHANGERATE_API",
      }),
    );
    expect(result.status).toBe("created");
    expect(result.fx_rate?.source).toBe("API");
  });

  it("wires the admin FX page to the import endpoint", () => {
    const pageSource = readFileSync(
      join(process.cwd(), "src", "app", "admin", "fx-rates", "page.tsx"),
      "utf8",
    );
    const formSource = readFileSync(
      join(
        process.cwd(),
        "src",
        "app",
        "admin",
        "fx-rates",
        "_components",
        "fx-rate-import-form.tsx",
      ),
      "utf8",
    );

    expect(pageSource).toContain("FxRateImportForm");
    expect(formSource).toContain("/api/config/fx-rates/import");
    expect(formSource).toContain("Import API rate");
  });
});
