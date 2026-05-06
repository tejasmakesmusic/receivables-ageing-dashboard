/**
 * POST /api/admin/email-outbox/process
 *
 * Picks up QUEUED outbox rows (up to `batch` at a time), sends them via
 * Resend, and updates each row to SENT or FAILED.
 *
 * Callable by:
 *  - Admin session (via UI "Run now" button)
 *  - Vercel Cron (Authorization: Bearer CRON_SECRET)
 *
 * Idempotent — re-running is safe; already-SENT rows are skipped.
 */
import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { sendEmail } from "@/lib/email";
import { getPrisma } from "@/lib/prisma";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_BATCH = 20;

export async function POST(request: NextRequest) {
  // Auth: Admin session OR Vercel Cron bearer token
  const authHeader = request.headers.get("authorization");
  const cronSecret = (env as Record<string, string | undefined>).CRON_SECRET;

  const isCron =
    cronSecret &&
    authHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    try {
      await requireRole(role_enum.ADMIN);
    } catch {
      return NextResponse.json(
        { code: "unauthorized", message: "Admin role or CRON_SECRET required" },
        { status: 401 },
      );
    }
  }

  const batch = DEFAULT_BATCH;
  const prisma = getPrisma();

  // Lock and pick up QUEUED rows (order by enqueued_at ascending — oldest first)
  const rows = await prisma.email_outbox.findMany({
    where: { status: "QUEUED" },
    orderBy: { enqueued_at: "asc" },
    take: batch,
  });

  if (rows.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0, skipped: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const recipients = Array.isArray(row.recipients_json)
      ? (row.recipients_json as string[])
      : (() => {
          try {
            return JSON.parse(row.recipients_json as string) as string[];
          } catch {
            return [] as string[];
          }
        })();

    if (recipients.length === 0) {
      // No recipients configured — skip silently (rule may not be active)
      await prisma.email_outbox.update({
        where: { id: row.id },
        data: { status: "FAILED", last_error: "No recipients configured", attempts: { increment: 1 } },
      });
      failed++;
      continue;
    }

    const result = await sendEmail({
      to: recipients,
      subject: row.subject,
      html: row.body_html,
    });

    if (result.skipped) {
      // No API key — mark as FAILED with a descriptive error so the admin sees
      // it in the outbox UI rather than silently losing the email
      await prisma.email_outbox.update({
        where: { id: row.id },
        data: { status: "FAILED", last_error: "RESEND_API_KEY not configured", attempts: { increment: 1 } },
      });
      skipped++;
    } else if (result.error) {
      await prisma.email_outbox.update({
        where: { id: row.id },
        data: { status: "FAILED", last_error: result.error, attempts: { increment: 1 } },
      });
      failed++;
    } else {
      await prisma.email_outbox.update({
        where: { id: row.id },
        data: { status: "SENT", sent_at: new Date(), attempts: { increment: 1 }, last_error: null },
      });
      sent++;
    }
  }

  return NextResponse.json({
    processed: rows.length,
    sent,
    failed,
    skipped,
  });
}
