import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { type AuthenticatedUser } from "@/server/core/auth";

const followUpChannelSchema = z.enum(["EMAIL", "CALL", "WHATSAPP", "MEETING"]);

const followUpEntitySchema = z.enum(["IND", "UAE", "ALL"]);

const followUpListQuerySchema = z.object({
  entity: followUpEntitySchema.optional(),
  channel: followUpChannelSchema.optional(),
  canonical_id: z.string().uuid("canonical_id must be a valid UUID").optional(),
  invoice_id: z.string().uuid("invoice_id must be a valid UUID").optional(),
  page: z.coerce.number().int().min(1, "page must be at least 1").default(1),
  page_size: z.coerce
    .number()
    .int()
    .min(1, "page_size must be at least 1")
    .max(200, "page_size must be at most 200")
    .default(50),
});

const followUpCreateBodySchema = z.object({
  date: z
    .string()
    .date("date must be YYYY-MM-DD")
    .transform((value) => `${value}T00:00:00.000Z`),
  channel: followUpChannelSchema,
  contact_person: z.string().nullable().optional(),
  next_action_date: z
    .string()
    .date("next_action_date must be YYYY-MM-DD")
    .nullable()
    .optional()
    .transform((value) =>
      typeof value === "string" ? `${value}T00:00:00.000Z` : value,
    ),
  notes: z.string().nullable().optional(),
});

const followUpRowSchema = z.object({
  id: z.string().uuid(),
  canonical_id: z.string().uuid(),
  canonical_name: z.string(),
  invoice_id: z.string().uuid().nullable(),
  invoice_ref: z.string().nullable(),
  date: z.string(),
  channel: followUpChannelSchema,
  contact_person: z.string().nullable(),
  next_action_date: z.string().nullable(),
  notes: z.string().nullable(),
  logged_by_email: z.string(),
  logged_at: z.string(),
});

const followUpListResponseSchema = z.object({
  items: z.array(followUpRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1).max(200),
});

export type FollowUpChannel = z.infer<typeof followUpChannelSchema>;
export type FollowUpEntity = z.infer<typeof followUpEntitySchema>;
export type FollowUpCreateBody = z.input<typeof followUpCreateBodySchema>;
export type ParsedFollowUpCreateBody = z.output<
  typeof followUpCreateBodySchema
>;
export type FollowUpListQuery = z.output<typeof followUpListQuerySchema>;
export type FollowUpRow = z.infer<typeof followUpRowSchema>;
export type FollowUpListResponse = z.infer<typeof followUpListResponseSchema>;

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError("validation_error", 400, "Invalid date");
  }

  return parsed;
}

function toDateValue(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function toDateTimeValue(value: Date): string {
  return value.toISOString();
}

type FollowUpSelectRow = Prisma.follow_upsGetPayload<{
  include: {
    parties_canonical: {
      select: {
        id: true;
        name: true;
      };
    };
    invoices: {
      select: {
        invoice_ref: true;
      };
    };
    users: {
      select: {
        email: true;
      };
    };
  };
}>;

function toFollowUpRow(row: FollowUpSelectRow): FollowUpRow {
  return {
    id: row.id,
    canonical_id: row.canonical_id,
    canonical_name: row.parties_canonical.name,
    invoice_id: row.invoice_id ?? null,
    invoice_ref: row.invoices?.invoice_ref ?? null,
    date: toDateValue(row.date) ?? "",
    channel: row.channel as FollowUpChannel,
    contact_person: row.contact_person ?? null,
    next_action_date: toDateValue(row.next_action_date),
    notes: row.notes ?? null,
    logged_by_email: row.users?.email ?? "",
    logged_at: toDateTimeValue(row.logged_at),
  };
}

function requireAnalystScope(user: AuthenticatedUser, entityId: string): void {
  if (user.role !== role_enum.ANALYST) {
    return;
  }

  if (!user.entityIdScope) {
    throw new HttpError("forbidden", 403, "Analyst user has no entity scope");
  }

  if (user.entityIdScope !== entityId) {
    throw new HttpError("forbidden", 403, "Analyst cannot access this entity");
  }
}

export function parseFollowUpListQuery(
  input: Record<string, string | undefined>,
): FollowUpListQuery {
  const parsed = followUpListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid follow-up list query.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export function parseFollowUpCreateBody(
  input: unknown,
): z.output<typeof followUpCreateBodySchema> {
  const parsed = followUpCreateBodySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid follow-up payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listFollowUps(
  query: FollowUpListQuery,
  currentUser: AuthenticatedUser,
): Promise<FollowUpListResponse> {
  const prisma = getPrisma();
  const where: Prisma.follow_upsWhereInput = {};
  const canonicalFilters: Prisma.parties_canonicalWhereInput[] = [];

  if (query.entity) {
    if (query.entity !== "ALL") {
      canonicalFilters.push({ entities: { code: query.entity } });
    }
  }

  if (query.canonical_id) {
    where.canonical_id = query.canonical_id;
  }

  if (query.invoice_id) {
    where.invoice_id = query.invoice_id;
  }

  if (
    query.channel &&
    ["EMAIL", "CALL", "WHATSAPP", "MEETING"].includes(query.channel)
  ) {
    where.channel = query.channel;
  }

  if (currentUser.role === role_enum.ANALYST) {
    if (!currentUser.entityIdScope) {
      throw new HttpError("forbidden", 403, "Analyst user has no entity scope");
    }

    canonicalFilters.push({ entity_id: currentUser.entityIdScope });
  }

  if (canonicalFilters.length === 1) {
    where.parties_canonical = canonicalFilters[0];
  } else if (canonicalFilters.length > 1) {
    where.parties_canonical = { AND: canonicalFilters };
  }

  const offset = (query.page - 1) * query.page_size;

  const [rows, total] = await Promise.all([
    prisma.follow_ups.findMany({
      where,
      orderBy: { logged_at: "desc" },
      skip: offset,
      take: query.page_size,
      include: {
        parties_canonical: {
          select: { id: true, name: true },
        },
        invoices: {
          select: { invoice_ref: true },
        },
        users: {
          select: { email: true },
        },
      },
    }),
    prisma.follow_ups.count({ where }),
  ]);

  const response: FollowUpListResponse = followUpListResponseSchema.parse({
    items: rows.map((row) => toFollowUpRow(row as FollowUpSelectRow)),
    total,
    page: query.page,
    page_size: query.page_size,
  });

  return response;
}

export async function createPartyFollowUp(
  canonicalId: string,
  body: ReturnType<typeof parseFollowUpCreateBody>,
  currentUser: AuthenticatedUser,
): Promise<FollowUpRow> {
  const prisma = getPrisma();
  const canonical = await prisma.parties_canonical.findUnique({
    where: { id: canonicalId },
    select: { id: true, entity_id: true },
  });

  if (!canonical) {
    throw new HttpError("not_found", 404, `Party ${canonicalId} not found`);
  }

  requireAnalystScope(currentUser, canonical.entity_id);

  const followUp = await prisma.follow_ups.create({
    data: {
      id: createId(),
      invoice_id: null,
      canonical_id: canonical.id,
      date: parseDate(`${body.date}`),
      channel: body.channel,
      contact_person: body.contact_person ?? null,
      next_action_date: body.next_action_date
        ? parseDate(`${body.next_action_date}`)
        : null,
      notes: body.notes ?? null,
      logged_by: currentUser.id,
    },
    include: {
      parties_canonical: { select: { id: true, name: true } },
      invoices: { select: { invoice_ref: true } },
      users: { select: { email: true } },
    },
  });

  await createAuditLog(
    currentUser.id,
    "follow_up.created",
    "follow_up",
    followUp.id,
    null,
    {
      channel: followUp.channel,
      date: followUp.date.toISOString().slice(0, 10),
      notes: followUp.notes,
    },
  );

  return followUpRowSchema.parse(toFollowUpRow(followUp as FollowUpSelectRow));
}

export async function createInvoiceFollowUp(
  invoiceId: string,
  body: ReturnType<typeof parseFollowUpCreateBody>,
  currentUser: AuthenticatedUser,
): Promise<FollowUpRow> {
  const prisma = getPrisma();
  const invoice = await prisma.invoices.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      canonical_id: true,
      parties_canonical: {
        select: { entity_id: true, id: true },
      },
    },
  });

  if (!invoice) {
    throw new HttpError("not_found", 404, `Invoice ${invoiceId} not found`);
  }

  requireAnalystScope(currentUser, invoice.parties_canonical.entity_id);

  const followUp = await prisma.follow_ups.create({
    data: {
      id: createId(),
      invoice_id: invoice.id,
      canonical_id: invoice.canonical_id,
      date: parseDate(`${body.date}`),
      channel: body.channel,
      contact_person: body.contact_person ?? null,
      next_action_date: body.next_action_date
        ? parseDate(`${body.next_action_date}`)
        : null,
      notes: body.notes ?? null,
      logged_by: currentUser.id,
    },
    include: {
      parties_canonical: { select: { id: true, name: true } },
      invoices: { select: { invoice_ref: true } },
      users: { select: { email: true } },
    },
  });

  await createAuditLog(
    currentUser.id,
    "follow_up.created",
    "follow_up",
    followUp.id,
    null,
    {
      channel: followUp.channel,
      date: followUp.date.toISOString().slice(0, 10),
      notes: followUp.notes,
    },
  );

  return followUpRowSchema.parse(toFollowUpRow(followUp as FollowUpSelectRow));
}
