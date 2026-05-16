import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

const currencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => value.length === 3, {
    message: "Currency code must be exactly 3 characters.",
  });

const fxRateListQuerySchema = z.object({
  from_ccy: currencyCodeSchema.optional(),
  to_ccy: currencyCodeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

const fxRateCreateSchema = z.object({
  from_ccy: currencyCodeSchema,
  to_ccy: currencyCodeSchema,
  rate: z.number().positive(),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "valid_from must be YYYY-MM-DD"),
  notes: z.string().trim().optional(),
});

export const fxRateResponseSchema = z.object({
  id: z.string().uuid(),
  from_ccy: z.string(),
  to_ccy: z.string(),
  rate: z.string(),
  valid_from: z.string(),
  source: z.string(),
  created_at: z.string(),
  created_by_email: z.string().nullable(),
});

export const fxRateListResponseSchema = z.object({
  items: z.array(fxRateResponseSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

export type FxRateListQuery = z.infer<typeof fxRateListQuerySchema>;
export type FxRateListResponse = z.infer<typeof fxRateListResponseSchema>;
export type FxRateRow = z.infer<typeof fxRateResponseSchema>;
export type FxRateCreateBody = z.infer<typeof fxRateCreateSchema>;

type FxRatePayload = Prisma.fx_ratesGetPayload<{
  select: {
    id: true;
    from_ccy: true;
    to_ccy: true;
    rate: true;
    effective_from: true;
    source: true;
    created_at: true;
    users: {
      select: {
        email: true;
      };
    };
  };
}>;

function parseDateOnly(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError("validation_error", 400, "Invalid date format.");
  }

  return parsed;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDateTime(value: Date): string {
  return value.toISOString();
}

function toRateString(rate: unknown): string {
  if (rate && typeof rate === "object" && "toString" in rate) {
    return String(rate);
  }

  return String(rate);
}

function toFxRateRow(row: FxRatePayload): FxRateRow {
  return {
    id: row.id,
    from_ccy: row.from_ccy,
    to_ccy: row.to_ccy,
    rate: toRateString(row.rate),
    valid_from: toDateOnly(row.effective_from),
    source: row.source,
    created_at: toDateTime(row.created_at),
    created_by_email: row.users?.email ?? null,
  };
}

export function parseFxRateListQuery(
  input: Record<string, string | undefined>,
): FxRateListQuery {
  const parsed = fxRateListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid FX rate query parameters.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseFxRateCreateBody(input: unknown): FxRateCreateBody {
  const parsed = fxRateCreateSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid FX rate payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listFxRates(
  query: FxRateListQuery,
  currentUser: AuthenticatedUser,
): Promise<FxRateListResponse> {
  if (currentUser.role === role_enum.PENDING) {
    throw new HttpError("forbidden", 403, "Insufficient permissions.");
  }

  const where: Prisma.fx_ratesWhereInput = {
    ...(query.from_ccy ? { from_ccy: query.from_ccy } : {}),
    ...(query.to_ccy ? { to_ccy: query.to_ccy } : {}),
  };

  const [total, rows] = await Promise.all([
    getPrisma().fx_rates.count({ where }),
    getPrisma().fx_rates.findMany({
      where,
      orderBy: { effective_from: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
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
    }),
  ]);

  return {
    items: rows.map(toFxRateRow),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}

export async function createFxRate(
  input: FxRateCreateBody,
  currentUser: AuthenticatedUser,
): Promise<FxRateRow> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const effectiveFrom = parseDateOnly(input.valid_from);
  const existing = await prisma.fx_rates.findFirst({
    where: {
      from_ccy: input.from_ccy,
      to_ccy: input.to_ccy,
      effective_from: effectiveFrom,
    },
  });

  if (existing) {
    throw new HttpError(
      "FX_RATE_DUPLICATE",
      409,
      `A rate for ${input.from_ccy}→${input.to_ccy} effective ${input.valid_from} already exists.`,
    );
  }

  const created = await prisma.fx_rates.create({
    data: {
      id: createId(),
      from_ccy: input.from_ccy,
      to_ccy: input.to_ccy,
      rate: new Prisma.Decimal(input.rate),
      effective_from: effectiveFrom,
      source: "MANUAL",
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
    "fx_rate.create",
    "fx_rates",
    created.id,
    {},
    {
      from_ccy: created.from_ccy,
      to_ccy: created.to_ccy,
      rate: toRateString(created.rate),
      effective_from: toDateOnly(created.effective_from),
      source: created.source,
    },
  );

  return toFxRateRow(created);
}
