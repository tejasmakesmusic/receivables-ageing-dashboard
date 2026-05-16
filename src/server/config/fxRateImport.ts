import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

const PROVIDER = "EXCHANGERATE_API" as const;

const currencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => value.length === 3, {
    message: "Currency code must be exactly 3 characters.",
  });

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const fxRateImportSchema = z.object({
  from_ccy: currencyCodeSchema.default("AED"),
  to_ccy: currencyCodeSchema.default("INR"),
  date: dateOnlySchema,
});

type FetchLike = (
  input: string,
  init?: { cache?: RequestCache },
) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

type ExchangeRateApiSuccess = {
  result: "success";
  base_code?: unknown;
  year?: unknown;
  month?: unknown;
  day?: unknown;
  conversion_rates?: unknown;
};

type ExchangeRateApiError = {
  result: "error";
  "error-type"?: unknown;
};

type ExchangeRateApiPayload = ExchangeRateApiSuccess | ExchangeRateApiError;

export type FxRateImportBody = z.infer<typeof fxRateImportSchema>;

export type ProviderFxRate = {
  provider: typeof PROVIDER;
  date: string;
  from_ccy: string;
  to_ccy: string;
  rate: number;
};

export type FxRateImportResponse = {
  status: "created" | "already_exists";
  provider: typeof PROVIDER;
  requested_date: string;
  fx_rate: {
    id: string;
    from_ccy: string;
    to_ccy: string;
    rate: string;
    valid_from: string;
    source: string;
    created_at: string;
    created_by_email: string | null;
  } | null;
};

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError("validation_error", 400, "date must be a valid YYYY-MM-DD");
  }
  return parsed;
}

function dateParts(value: string) {
  const date = parseDateOnly(value);
  return {
    date,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toRateString(rate: unknown): string {
  if (rate && typeof rate === "object" && "toString" in rate) {
    return String(rate);
  }
  return String(rate);
}

function asExchangeRateApiPayload(value: unknown): ExchangeRateApiPayload {
  if (!value || typeof value !== "object" || !("result" in value)) {
    throw new HttpError(
      "fx_rate_provider_error",
      502,
      "ExchangeRate-API returned an invalid response.",
    );
  }
  return value as ExchangeRateApiPayload;
}

function conversionRate(payload: ExchangeRateApiPayload, toCcy: string): number {
  if (payload.result === "error") {
    const errorType =
      typeof payload["error-type"] === "string"
        ? payload["error-type"]
        : "unknown-error";
    throw new HttpError(
      "fx_rate_provider_error",
      502,
      `ExchangeRate-API could not return rates: ${errorType}`,
    );
  }

  const rates = payload.conversion_rates;
  if (!rates || typeof rates !== "object") {
    throw new HttpError(
      "fx_rate_provider_error",
      502,
      "ExchangeRate-API returned no conversion rates.",
    );
  }

  const value = (rates as Record<string, unknown>)[toCcy];
  const rate = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new HttpError(
      "fx_rate_provider_error",
      502,
      `ExchangeRate-API returned no ${toCcy} rate.`,
    );
  }
  return rate;
}

function toResponseRow(row: {
  id: string;
  from_ccy: string;
  to_ccy: string;
  rate: unknown;
  effective_from: Date;
  source: string;
  created_at: Date;
  users?: { email?: string | null } | null;
}): NonNullable<FxRateImportResponse["fx_rate"]> {
  return {
    id: row.id,
    from_ccy: row.from_ccy,
    to_ccy: row.to_ccy,
    rate: toRateString(row.rate),
    valid_from: toDateOnly(row.effective_from),
    source: row.source,
    created_at: row.created_at.toISOString(),
    created_by_email: row.users?.email ?? null,
  };
}

export function parseFxRateImportBody(input: unknown): FxRateImportBody {
  const parsed = fxRateImportSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid FX rate import payload.";
    throw new HttpError("validation_error", 400, message);
  }
  if (parsed.data.from_ccy === parsed.data.to_ccy) {
    throw new HttpError("validation_error", 400, "from_ccy and to_ccy must differ");
  }
  return parsed.data;
}

export async function fetchExchangeRateApiHistoricalRate({
  apiKey,
  fromCcy,
  toCcy,
  date,
  fetchFn = fetch as FetchLike,
}: {
  apiKey: string;
  fromCcy: string;
  toCcy: string;
  date: string;
  fetchFn?: FetchLike;
}): Promise<ProviderFxRate> {
  const { year, month, day } = dateParts(date);
  const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(
    apiKey,
  )}/history/${encodeURIComponent(fromCcy)}/${year}/${month}/${day}`;

  let payload: ExchangeRateApiPayload;
  try {
    const response = await fetchFn(url, { cache: "no-store" });
    payload = asExchangeRateApiPayload(await response.json());
    if (!response.ok && payload.result !== "error") {
      throw new HttpError(
        "fx_rate_provider_error",
        502,
        `ExchangeRate-API returned HTTP ${response.status ?? "error"}.`,
      );
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      "fx_rate_provider_error",
      502,
      "ExchangeRate-API request failed.",
    );
  }

  try {
    return {
      provider: PROVIDER,
      date,
      from_ccy: fromCcy,
      to_ccy: toCcy,
      rate: conversionRate(payload, toCcy),
    };
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.code === "fx_rate_provider_error" &&
      payload.result === "error"
    ) {
      const errorType =
        typeof payload["error-type"] === "string"
          ? payload["error-type"]
          : "unknown-error";
      throw new HttpError(
        "fx_rate_provider_error",
        502,
        `ExchangeRate-API could not return ${fromCcy}->${toCcy} for ${date}: ${errorType}`,
      );
    }
    throw error;
  }
}

export async function importExchangeRateApiFxRate(
  input: FxRateImportBody,
  currentUser: AuthenticatedUser,
  options: { fetchFn?: FetchLike; apiKey?: string } = {},
): Promise<FxRateImportResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const apiKey = options.apiKey ?? process.env.EXCHANGERATE_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      "fx_rate_provider_not_configured",
      500,
      "EXCHANGERATE_API_KEY is not configured.",
    );
  }

  const effectiveFrom = parseDateOnly(input.date);
  const prisma = getPrisma();
  const existing = await prisma.fx_rates.findFirst({
    where: {
      from_ccy: input.from_ccy,
      to_ccy: input.to_ccy,
      effective_from: effectiveFrom,
    },
    select: {
      id: true,
      from_ccy: true,
      to_ccy: true,
      rate: true,
      effective_from: true,
      source: true,
      created_at: true,
      users: { select: { email: true } },
    },
  });

  if (existing) {
    return {
      status: "already_exists",
      provider: PROVIDER,
      requested_date: input.date,
      fx_rate: toResponseRow(existing),
    };
  }

  const providerRate = await fetchExchangeRateApiHistoricalRate({
    apiKey,
    fromCcy: input.from_ccy,
    toCcy: input.to_ccy,
    date: input.date,
    fetchFn: options.fetchFn,
  });

  const created = await prisma.fx_rates.create({
    data: {
      id: createId(),
      from_ccy: input.from_ccy,
      to_ccy: input.to_ccy,
      rate: new Prisma.Decimal(providerRate.rate),
      effective_from: effectiveFrom,
      source: "API",
      created_by: currentUser.id,
    },
    select: {
      id: true,
      from_ccy: true,
      to_ccy: true,
      rate: true,
      effective_from: true,
      source: true,
      created_at: true,
      users: { select: { email: true } },
    },
  });

  await createAuditLog(
    currentUser.id,
    "fx_rate.import",
    "fx_rates",
    created.id,
    {},
    {
      from_ccy: created.from_ccy,
      to_ccy: created.to_ccy,
      rate: toRateString(created.rate),
      effective_from: toDateOnly(created.effective_from),
      source: created.source,
      provider: PROVIDER,
    },
  );

  return {
    status: "created",
    provider: PROVIDER,
    requested_date: input.date,
    fx_rate: toResponseRow(created),
  };
}
