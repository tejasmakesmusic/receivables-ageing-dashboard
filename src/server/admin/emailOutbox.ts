import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import { z } from "zod";
import type { AuthenticatedUser } from "@/server/core/auth";

export const emailOutboxListQuerySchema = z.object({
  status: z.string().optional(),
  rule_type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const emailOutboxListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      rule_type: z.string(),
      snapshot_id: z.string().uuid().nullable(),
      subject: z.string(),
      status: z.string(),
      attempts: z.number().int(),
      enqueued_at: z.string(),
      sent_at: z.string().nullable(),
      last_error: z.string().nullable(),
    }),
  ),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});

export const emailOutboxMarkSentSchema = z.object({
  note: z.string().trim().optional(),
});

export const emailOutboxMarkSentResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  sent_at: z.string(),
});

export type EmailOutboxListQuery = z.infer<typeof emailOutboxListQuerySchema>;
export type EmailOutboxListResponse = z.infer<
  typeof emailOutboxListResponseSchema
>;
export type EmailOutboxMarkSentInput = z.infer<
  typeof emailOutboxMarkSentSchema
>;
export type EmailOutboxMarkSentResponse = z.infer<
  typeof emailOutboxMarkSentResponseSchema
>;

function toDateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function parseEmailOutboxListQuery(
  input: Record<string, string | undefined>,
): EmailOutboxListQuery {
  const parsed = emailOutboxListQuerySchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid email outbox query.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

function parseEmailOutboxMarkSentBody(
  input: unknown,
): EmailOutboxMarkSentInput {
  const parsed = emailOutboxMarkSentSchema.safeParse(input);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid mark-sent payload.";
    throw new HttpError("validation_error", 400, message);
  }

  return parsed.data;
}

export async function listEmailOutbox(
  query: EmailOutboxListQuery,
  currentUser: AuthenticatedUser,
): Promise<EmailOutboxListResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const where: Prisma.email_outboxWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.rule_type ? { rule_type: query.rule_type } : {}),
  };

  const prisma = getPrisma();
  const [total, rows] = await Promise.all([
    prisma.email_outbox.count({ where }),
    prisma.email_outbox.findMany({
      where,
      orderBy: { enqueued_at: "desc" },
      skip: (query.page - 1) * query.page_size,
      take: query.page_size,
      select: {
        id: true,
        rule_type: true,
        snapshot_id: true,
        subject: true,
        status: true,
        attempts: true,
        enqueued_at: true,
        sent_at: true,
        last_error: true,
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      rule_type: row.rule_type,
      snapshot_id: row.snapshot_id,
      subject: row.subject,
      status: row.status,
      attempts: row.attempts,
      enqueued_at: toDateTime(row.enqueued_at)!,
      sent_at: toDateTime(row.sent_at),
      last_error: row.last_error,
    })),
    total,
    page: query.page,
    page_size: query.page_size,
  };
}

export async function markEmailOutboxSent(
  outboxId: string,
  input: EmailOutboxMarkSentInput,
  currentUser: AuthenticatedUser,
): Promise<EmailOutboxMarkSentResponse> {
  if (currentUser.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required.");
  }

  const prisma = getPrisma();
  const outbox = await prisma.email_outbox.findUnique({
    where: { id: outboxId },
    select: {
      id: true,
      status: true,
      sent_at: true,
      snapshot_id: true,
      rule_type: true,
      subject: true,
      attempts: true,
      enqueued_at: true,
      last_error: true,
    },
  });

  if (!outbox) {
    throw new HttpError("not_found", 404, "Email outbox row not found.");
  }

  if (outbox.status === "SENT") {
    throw new HttpError(
      "ALREADY_SENT",
      409,
      "Email outbox row is already SENT.",
    );
  }

  const sentAt = new Date();
  const updated = await prisma.email_outbox.update({
    where: { id: outbox.id },
    data: {
      status: "SENT",
      sent_at: sentAt,
    },
    select: {
      id: true,
      status: true,
      sent_at: true,
    },
  });

  await createAuditLog(
    currentUser.id,
    "email_outbox.mark_sent",
    "email_outbox",
    outbox.id,
    { status: outbox.status, sent_at: toDateTime(outbox.sent_at) },
    {
      status: updated.status,
      sent_at: toDateTime(updated.sent_at),
      note: input.note ?? null,
    },
  );

  return {
    id: updated.id,
    status: updated.status,
    sent_at: toDateTime(updated.sent_at) ?? "",
  };
}

export { parseEmailOutboxListQuery, parseEmailOutboxMarkSentBody };
